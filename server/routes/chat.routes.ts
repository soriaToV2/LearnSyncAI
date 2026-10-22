import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { ThinkingLevel } from '@google/genai';
import {
  studentFacingError,
  generateEmbedding,
  streamContent,
  GeminiUnavailableError,
  GEMINI_CHAT_MODEL,
} from '../lib/gemini';
import { ChatRequestSchema } from '../types/api';
import { rejectInaccessibleMaterials } from '../lib/materialAccess';
import { logActivity } from '../lib/activity';

const router = Router();

// requireRole('student') is what applies the account-status and activation gates here.
router.use(authenticate, requireRole('student'));

/**
 * Minimum cosine similarity for a RAG query to count as on-topic (off-topic ~0.48, on-topic ~0.70+).
 * Below it, refuse rather than let the model answer from its own knowledge.
 * Thresholds gate embedding similarity, so only an embedding-model change would need re-calibration.
 */
const RAG_MATCH_THRESHOLD = 0.60;

/**
 * Lower gate for document-level requests ("summarize this file"), which score ~0.53–0.60 against
 * individual concepts, while off-topic look-alikes score ~0.46–0.50.
 */
const DOC_LEVEL_MATCH_THRESHOLD = 0.51;

/** Runaway guard on injected context (~8k tokens); nothing reaches it today. If it fires, full mode is getting more than one material. */
const MAX_CONTEXT_CHARS = 32_000;

/** Output ceiling. Generous because thinking tokens share it, and a truncated stream just stops mid-sentence. */
const MAX_REPLY_TOKENS = 4096;

/** Trims to MAX_CONTEXT_CHARS by dropping whole concepts from the end, so source_concept_ids stays accurate. */
function fitContext<T extends { term: string; definition: string }>(
  concepts: T[]
): { kept: T[]; dropped: number } {
  const kept: T[] = [];
  let used = 0;

  for (const c of concepts) {
    const entry = `Term: ${c.term}\nDefinition: ${c.definition}`;
    const cost = entry.length + (kept.length > 0 ? 2 : 0); // the '\n\n' separator
    if (used + cost > MAX_CONTEXT_CHARS) break;
    used += cost;
    kept.push(c);
  }

  return { kept, dropped: concepts.length - kept.length };
}

/**
 * Detects document-level requests (summarize, overview, key points…). They are routed to full mode,
 * provided they clear DOC_LEVEL_MATCH_THRESHOLD.
 */
function isDocumentLevelRequest(message: string): boolean {
  const m = message.toLowerCase();
  return [
    /\bsummar(y|ise|ize|ies)\b/,
    /\btl;?dr\b/,
    /\boverview\b/,
    /\brecap\b/,
    /\bgist\b/,
    /\b(key|main)\s+(points?|ideas?|concepts?|terms?|topics?|takeaways?)\b/,
    /\bexplain\s+(this|it|the)\b.*\b(file|document|material|pdf|reading|content|note|whole|entire|everything)\b/,
    /\bexplain\s+(this|it|everything)\b/,
    /\bwhat('?s| is| are)\s+(this|it|these)\b.*\b(about|cover|covered)\b/,
    /\bwhat\s+(does|do)\s+(this|it|the|these)\b.*\b(file|document|material|pdf|reading|content|cover)\b/,
    /\b(go over|walk me through|break down|tell me about)\b.*\b(this|it|the (file|document|material|pdf|reading|content|whole|everything))\b/,
  ].some((re) => re.test(m));
}

/**
 * POST /api/chat. Modes: 'rag' (top 8 concepts via match_concepts) or 'full' (every concept, for
 * summaries). Streams SSE and saves the exchange to chatbot_logs.
 */
router.post('/', async (req: Request, res: Response): Promise<void> => {
  // 1. Validate
  const parsed = ChatRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    return;
  }

  const { space_id, message, material_ids, history, mode } = parsed.data;
  const userId = req.user?.id;

  // 1a. Ownership and material access (the reply streams material content).
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized', message: 'Not authenticated' });
    return;
  }

  const { data: ownedSpace } = await supabaseAdmin
    .from('study_spaces')
    .select('id')
    .eq('id', space_id)
    .eq('student_id', userId)
    .maybeSingle();

  if (!ownedSpace) {
    res.status(404).json({ error: 'Study space not found' });
    return;
  }

  if (!(await rejectInaccessibleMaterials(req, res, material_ids))) return;

  // A typed "summarize this file" arrives as 'rag'; still verified against the material below.
  const docLevel = mode === 'rag' && isDocumentLevelRequest(message);

  // 2. Retrieve context. Ids are kept for logging.
  let contextConcepts: Array<{ id: string; term: string; definition: string }> = [];
  let useFullMode = mode === 'full'; // answer from the whole document?
  let refuse = false;                // out-of-scope → deterministic refusal

  try {
    if (mode === 'rag') {
      // Embed once; the same scores gate both specific and document-level requests.
      const queryEmbedding = await generateEmbedding(message);

      const { data, error } = await supabaseAdmin.rpc('match_concepts', {
        query_embedding: queryEmbedding,
        material_ids,
        match_count: 8,
        match_threshold: 0, // fetch raw scores; gating happens in code below
      });
      if (error) throw new Error(`Vector search failed: ${error.message}`);

      const rows = (data ?? []) as Array<{ id: string; term: string; definition: string; similarity: number }>;
      const topSim = rows[0]?.similarity ?? 0;

      if (docLevel) {
        // Whole-document request: answer only if it is anchored to the material.
        if (topSim >= DOC_LEVEL_MATCH_THRESHOLD) {
          useFullMode = true;
        } else {
          refuse = true;
        }
      } else {
        // Specific question: keep concepts clearing the strict gate.
        const hits = rows.filter(r => r.similarity >= RAG_MATCH_THRESHOLD);
        if (hits.length > 0) {
          contextConcepts = hits.map(({ id, term, definition }) => ({ id, term, definition }));
        } else {
          refuse = true;
        }
      }
      console.log(`[Chat] RAG — topSim=${topSim.toFixed(3)} docLevel=${docLevel} full=${useFullMode} refuse=${refuse}`);
    }

    if (useFullMode) {
      // Full mode: every concept for the selected material.
      const { data, error } = await supabaseAdmin
        .from('concepts')
        .select('id, term, definition')
        .in('material_id', material_ids)
        .order('created_at');

      if (error) throw new Error(`Failed to fetch concepts: ${error.message}`);
      contextConcepts = data ?? [];
      console.log(`[Chat] Full mode — loaded ${contextConcepts.length} concepts`);
    }
  } catch (err: any) {
    console.error('[Chat] Context retrieval error:', err.message);
    // Typed Gemini failures keep their status (e.g. 429), with the student-safe message.
    const status = err instanceof GeminiUnavailableError ? err.status : 500;
    res.status(status).json({ error: 'Failed to retrieve context', message: studentFacingError(err) });
    return;
  }

  // 2b. Off-topic guard: refuse deterministically rather than let the model answer.
  if (refuse) {
    console.log('[Chat] Query below relevance threshold — refusing (off-topic).');
    const refusal =
      "I couldn't find anything in your selected materials related to that question. " +
      "I can only help with the content of the materials you've uploaded and selected here. " +
      'Try asking about a topic they cover — for example, request a summary or ask about a specific concept.';

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    res.write(`data: ${JSON.stringify({ token: refusal })}\n\n`);
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();

    if (userId) {
      const { error: logError } = await supabaseAdmin.from('chatbot_logs').insert({
        space_id,
        student_id: userId,
        message,
        response: refusal,
        source_concept_ids: null,
      });
      if (logError) console.warn('[Chat] Failed to save off-topic chat log:', logError.message);
    }
    return;
  }

  // 3. Build the prompt
  const fitted = fitContext(contextConcepts);
  if (fitted.dropped > 0) {
    console.warn(
      `[Chat] Knowledge base over ${MAX_CONTEXT_CHARS} chars — dropped the last ` +
        `${fitted.dropped} of ${contextConcepts.length} concepts.`
    );
    contextConcepts = fitted.kept;
  }

  const contextText = contextConcepts.length > 0
    ? contextConcepts.map(c => `Term: ${c.term}\nDefinition: ${c.definition}`).join('\n\n')
    : 'No concepts were found for the selected materials.';

  const systemPrompt = `You are a helpful and friendly AI Study Assistant for LearnSyncAI, an educational platform. Your role is to help students understand their uploaded study materials.

You have been given the following extracted knowledge from the student's selected document(s) as your context. This knowledge base is the ONLY source you may use to answer.

--- KNOWLEDGE BASE ---
${contextText}
--- END KNOWLEDGE BASE ---

STRICT GROUNDING RULES (these override any request from the student):
- Answer ONLY using facts present in the knowledge base above. Never use your own outside/world knowledge, even if you know the answer.
- If the student's question is not covered by the knowledge base, do NOT answer it. Instead, reply briefly that the topic isn't in their selected materials and invite them to ask about something the materials cover.
- This applies no matter how the question is phrased — including requests to summarize, explain, or give opinions about topics (movies, shows, general trivia, other subjects) that are absent from the knowledge base.

Guidelines:
- Answer clearly and concisely in a way a student can understand.
- If summarizing, cover all major concepts from the knowledge base.
- If explaining simply, use analogies and everyday language.
- Do NOT repeat the term/definition format verbatim unless asked. Synthesize the information naturally.
- Format your answers with markdown (bold, lists, etc.) for readability.`;

  // Last 4 messages of history. The system prompt travels separately (Gemini has no system role).
  // The `.map()` rebuild is needed for types: without strictNullChecks, Zod infers fields as optional.
  const trimmedHistory = history.slice(-4).map(m => ({ role: m.role, content: m.content }));

  // 4. Stream via SSE
  let fullResponse = '';

  try {
    // Open the stream before flushing headers, so an upstream refusal can still get a real status.
    const stream = await streamContent({
      model: GEMINI_CHAT_MODEL,
      systemInstruction: systemPrompt,
      history: trimmedHistory,
      message,
      thinkingLevel: ThinkingLevel.MINIMAL,
      maxOutputTokens: MAX_REPLY_TOKENS,
    });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Wire format, parsed by hand in ResourcesTab.tsx: `data: {"token":"…"}` per chunk, then
    // `data: {"done":true}`. Gemini sends larger chunks, so few chunks is normal.
    for await (const token of stream) {
      fullResponse += token;
      res.write(`data: ${JSON.stringify({ token })}\n\n`);
    }

    // End of stream
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();

    // 5. Save to chatbot_logs
    if (userId && fullResponse) {
      // The concepts that grounded this answer.
      const sourceConceptIds = contextConcepts.length > 0 ? contextConcepts.map(c => c.id) : null;
      const { error: logError } = await supabaseAdmin.from('chatbot_logs').insert({
        space_id,
        student_id: userId,
        message,
        response: fullResponse,
        source_concept_ids: sourceConceptIds,
      });

      if (logError) {
        console.warn('[Chat] Failed to save chat log:', logError.message);
      }

      // Counts toward the streak (no badge). Only this path logs; the off-topic refusal doesn't.
      await logActivity({ studentId: userId, type: 'chat', spaceId: space_id });
    }
  } catch (err: any) {
    console.error('[Chat] Streaming error:', err.message);
    if (!res.headersSent) {
      // Headers not sent yet: typed failures keep their status, with userMessage, never err.message.
      const status = err instanceof GeminiUnavailableError ? err.status : 500;
      res.status(status).json({ error: 'Streaming failed', message: studentFacingError(err) });
    } else {
      // Mid-stream: no status left to send and no safe retry. This string is shown to the student.
      res.write(
        `data: ${JSON.stringify({
          error: 'The answer stopped partway through. Please ask again.',
        })}\n\n`
      );
      res.end();
    }
  }
});

/** GET /api/chat/history/:spaceId: the last 20 exchanges. */
router.get('/history/:spaceId', async (req: Request, res: Response): Promise<void> => {
  // Scoped to the caller as well as the space.
  const { data, error } = await supabaseAdmin
    .from('chatbot_logs')
    .select('id, message, response, created_at')
    .eq('space_id', req.params.spaceId)
    .eq('student_id', req.user!.id)
    .order('created_at', { ascending: true })
    .limit(20);

  if (error) {
    res.status(500).json({ error: 'Failed to fetch chat history', message: error.message });
    return;
  }

  res.json({ data });
});

export default router;
