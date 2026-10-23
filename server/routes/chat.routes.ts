import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { ThinkingLevel } from '@google/genai';
import {
  studentFacingError,
  streamContent,
  GeminiUnavailableError,
  GEMINI_CHAT_MODEL,
} from '../lib/gemini';
import { ChatRequestSchema } from '../types/api';
import { rejectInaccessibleMaterials } from '../lib/materialAccess';
import { logActivity } from '../lib/activity';
import {
  resolveChatContext,
  buildChatSystemPrompt,
  CHAT_HISTORY_MESSAGES,
  type ChatContextDecision,
} from '../lib/chatContext';

const router = Router();

// requireRole('student') is what applies the account-status and activation gates here.
router.use(authenticate, requireRole('student'));

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
 * POST /api/chat. Modes: 'rag' (top 8 concepts via match_concepts) or 'full' (every concept, for
 * summaries); the context decision lives in lib/chatContext.ts. Streams SSE and saves the exchange
 * to chatbot_logs.
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

  // The window the model sees is also the one a follow-up is matched through.
  // The `.map()` rebuild is needed for types: without strictNullChecks, Zod infers fields as optional.
  const trimmedHistory = history
    .slice(-CHAT_HISTORY_MESSAGES)
    .map(m => ({ role: m.role, content: m.content }));

  // 2. Retrieve context. Ids are kept for logging.
  let decision: ChatContextDecision;
  try {
    decision = await resolveChatContext({ message, history: trimmedHistory, materialIds: material_ids, mode });
    console.log(
      `[Chat] ${decision.kind} — topSim=${decision.topSim.toFixed(3)}` +
        (decision.followUpTopSim !== null ? ` followUpTopSim=${decision.followUpTopSim.toFixed(3)}` : '') +
        ` followUp=${decision.followUp} concepts=${decision.concepts.length}`
    );
  } catch (err: any) {
    console.error('[Chat] Context retrieval error:', err.message);
    // Typed Gemini failures keep their status (e.g. 429), with the student-safe message.
    const status = err instanceof GeminiUnavailableError ? err.status : 500;
    res.status(status).json({ error: 'Failed to retrieve context', message: studentFacingError(err) });
    return;
  }

  let contextConcepts = decision.concepts;

  // 2b. Off-topic guard: refuse deterministically rather than let the model answer.
  if (decision.kind === 'refuse') {
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

  // The system prompt travels separately from the history (Gemini has no system role).
  const systemPrompt = buildChatSystemPrompt(contextConcepts, { followUp: decision.followUp });

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

/** GET /api/chat/history/:spaceId: the last 20 exchanges, oldest first. */
router.get('/history/:spaceId', async (req: Request, res: Response): Promise<void> => {
  // Scoped to the caller as well as the space. Newest 20 first, then reversed: ascending + limit
  // returned the OLDEST 20, so a long chat lost its recent turns on reload.
  const { data, error } = await supabaseAdmin
    .from('chatbot_logs')
    .select('id, message, response, created_at')
    .eq('space_id', req.params.spaceId)
    .eq('student_id', req.user!.id)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    res.status(500).json({ error: 'Failed to fetch chat history', message: error.message });
    return;
  }

  res.json({ data: (data ?? []).reverse() });
});

export default router;
