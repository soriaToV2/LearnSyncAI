import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { authenticate } from '../middleware/auth';
import { generateEmbedding } from '../lib/gemini';
import { streamChatCompletion } from '../lib/groq';
import { ChatRequestSchema } from '../types/api';

const router = Router();
router.use(authenticate);

/**
 * Minimum cosine similarity a retrieved concept must clear for a RAG query to be
 * considered "on-topic" for the selected material(s).
 *
 * Calibrated empirically against a cybersecurity material: off-topic queries
 * (e.g. a K-drama plot, a cookie recipe) top out around ~0.48 similarity, while
 * genuinely on-topic questions land at ~0.70+. A 0.60 gate cleanly separates the
 * two with comfortable margin on both sides. If the best match falls below this,
 * the query is treated as out-of-scope and we refuse instead of calling the LLM
 * (which — being llama-3.1-8b-instant — otherwise happily answers from its own
 * world knowledge, ignoring the "use ONLY this context" instruction).
 */
const RAG_MATCH_THRESHOLD = 0.60;

/**
 * POST /api/chat
 *
 * Study Assistant chatbot endpoint.
 *
 * Supports two modes:
 *  - 'rag':  Embeds the student query and retrieves the top 8 most relevant
 *            concepts via pgvector cosine similarity (match_concepts RPC).
 *            Best for specific questions.
 *  - 'full': Fetches ALL concepts for the selected materials and feeds them
 *            to the AI. Best for summarise / explain-simply quick actions.
 *
 * Streams the AI response back using Server-Sent Events (text/event-stream).
 * Saves the completed exchange to the chatbot_logs table for persistence.
 *
 * Body: ChatRequestInput (see server/types/api.ts)
 */
router.post('/', async (req: Request, res: Response): Promise<void> => {
  // ── 1. Validate request body ──────────────────────────────────────────────
  const parsed = ChatRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    return;
  }

  const { space_id, message, material_ids, history, mode } = parsed.data;
  const userId = req.user?.id;

  // ── 2. Retrieve context from the concepts table ────────────────────────────
  let contextConcepts: Array<{ term: string; definition: string }> = [];
  // In RAG mode, whether the query cleared the relevance gate for the material(s).
  let ragOnTopic = true;

  try {
    if (mode === 'full') {
      // FULL MODE: fetch ALL concepts for selected materials (for summaries)
      const { data, error } = await supabaseAdmin
        .from('concepts')
        .select('term, definition')
        .in('material_id', material_ids)
        .order('created_at');

      if (error) throw new Error(`Failed to fetch concepts: ${error.message}`);
      contextConcepts = data ?? [];
      console.log(`[Chat] Full mode — loaded ${contextConcepts.length} concepts for summary`);
    } else {
      // RAG MODE: embed the query and do a threshold-gated vector similarity
      // search. match_concepts only returns concepts scoring >= RAG_MATCH_THRESHOLD,
      // so an empty result means the question is off-topic for these materials.
      const queryEmbedding = await generateEmbedding(message);

      const { data, error } = await supabaseAdmin.rpc('match_concepts', {
        query_embedding: queryEmbedding,
        material_ids,
        match_count: 8,
        match_threshold: RAG_MATCH_THRESHOLD,
      });

      if (error) throw new Error(`Vector search failed: ${error.message}`);
      contextConcepts = data ?? [];
      ragOnTopic = contextConcepts.length > 0;
      console.log(`[Chat] RAG mode — retrieved ${contextConcepts.length} relevant concepts (threshold ${RAG_MATCH_THRESHOLD})`);
    }
  } catch (err: any) {
    console.error('[Chat] Context retrieval error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve context', message: err.message });
    return;
  }

  // ── 2b. Off-topic guard ────────────────────────────────────────────────────
  // If a free-typed (RAG) question matched nothing above the relevance threshold,
  // the student is asking about something not covered by their selected materials.
  // Refuse deterministically instead of letting the LLM answer from world knowledge.
  if (!ragOnTopic) {
    console.log('[Chat] RAG query below relevance threshold — refusing (off-topic).');
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

  // ── 3. Build prompt messages ───────────────────────────────────────────────
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

  // Keep last 4 messages of history (2 exchanges) to save tokens
  const trimmedHistory = history.slice(-4);

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt },
    ...trimmedHistory.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user', content: message },
  ];

  // ── 4. Stream the response via SSE ────────────────────────────────────────
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let fullResponse = '';

  try {
    const stream = await streamChatCompletion(messages);

    for await (const chunk of stream) {
      const token = chunk.choices[0]?.delta?.content ?? '';
      if (token) {
        fullResponse += token;
        res.write(`data: ${JSON.stringify({ token })}\n\n`);
      }
    }

    // Signal stream end
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();

    // ── 5. Save exchange to chatbot_logs ─────────────────────────────────────
    if (userId && fullResponse) {
      const { error: logError } = await supabaseAdmin.from('chatbot_logs').insert({
        space_id,
        student_id: userId,
        message,
        response: fullResponse,
        source_concept_ids: null, // Could be enriched later with concept UUIDs
      });

      if (logError) {
        console.warn('[Chat] Failed to save chat log:', logError.message);
      }
    }
  } catch (err: any) {
    console.error('[Chat] Streaming error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Streaming failed', message: err.message });
    } else {
      res.write(`data: ${JSON.stringify({ error: 'Stream interrupted' })}\n\n`);
      res.end();
    }
  }
});

/**
 * GET /api/chat/history/:spaceId
 * Returns the past chat history for a study space from chatbot_logs.
 * Returns last 20 exchanges ordered by time.
 */
router.get('/history/:spaceId', async (req: Request, res: Response): Promise<void> => {
  const { data, error } = await supabaseAdmin
    .from('chatbot_logs')
    .select('id, message, response, created_at')
    .eq('space_id', req.params.spaceId)
    .order('created_at', { ascending: true })
    .limit(20);

  if (error) {
    res.status(500).json({ error: 'Failed to fetch chat history', message: error.message });
    return;
  }

  res.json({ data });
});

export default router;
