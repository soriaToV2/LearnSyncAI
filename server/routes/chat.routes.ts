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
// PRE/POST GATE — temporary (migration 0024). Delete with the feature.
import { rejectLockedMaterials } from '../lib/assessmentGate';
import { logActivity } from '../lib/activity';

const router = Router();

/*
 * ⚠️ `requireRole('student')` WAS MISSING FROM THIS FILE ENTIRELY.
 *
 * Both routes ran on `authenticate` alone, which proves only that the caller
 * holds a valid token — so an educator or admin could drive the student chatbot,
 * and neither route checked `profiles.status`. `POST /` was partially covered by
 * `rejectInaccessibleMaterials()` (which loads the caller and rejects a disabled
 * account), but `GET /history/:spaceId` scoped by `student_id` alone and read no
 * account state at all.
 *
 * It became load-bearing when the first-login gate landed: `requireRole` is the
 * only middleware that reads `profiles`, so a route without it is a hole in that
 * gate as well — an un-activated account could have used the chatbot.
 */
router.use(authenticate, requireRole('student'));

/**
 * Minimum cosine similarity a retrieved concept must clear for a RAG query to be
 * considered "on-topic" for the selected material(s).
 *
 * Calibrated empirically against a cybersecurity material: off-topic queries
 * (e.g. a K-drama plot, a cookie recipe) top out around ~0.48 similarity, while
 * genuinely on-topic questions land at ~0.70+. A 0.60 gate cleanly separates the
 * two with comfortable margin on both sides. If the best match falls below this,
 * the query is treated as out-of-scope and we refuse instead of calling the model
 * (which otherwise happily answers from its own world knowledge, ignoring the
 * "use ONLY this context" instruction — measured on llama-3.1-8b-instant, and not
 * a habit any model here is trusted to be free of).
 *
 * ⚠️ BOTH THRESHOLDS SURVIVED THE MOVE TO GEMINI UNCHANGED, and that is not an
 * oversight. They gate cosine similarity between EMBEDDINGS, and the embedding
 * model is fixed at `gemini-embedding-001` — changing which model writes the reply
 * cannot move them. Re-calibrate only if the embedding model ever changes, which
 * CLAUDE.md forbids for unrelated reasons.
 */
const RAG_MATCH_THRESHOLD = 0.60;

/**
 * Lower relevance gate applied to document-level requests (see below).
 *
 * A generic "summarize this file" has no topical keywords, so its best concept
 * match lands around ~0.53–0.60 — below RAG_MATCH_THRESHOLD but still clearly
 * anchored to the material. An off-topic request that merely *looks* like a
 * summary ("summarize the life lessons from Reply 1988") scores ~0.46–0.50,
 * because its real subject is external. This threshold sits in the gap: clear it
 * and the request is treated as a genuine whole-document summary; fall below and
 * it is refused. Set slightly below the legit-request floor so borderline real
 * summaries are never wrongly refused — the off-topic cases the gate might miss
 * are still caught by the strict grounding rules in the system prompt.
 */
const DOC_LEVEL_MATCH_THRESHOLD = 0.51;

/**
 * Ceiling on the knowledge base injected into one reply, in characters.
 *
 * ⚠️ THIS REPLACES A LIMIT THAT WAS NEVER IN THE CODE. Groq refused a request
 * past roughly 6,000 tokens with an HTTP 413, and the codebase recorded that
 * number in prose — CLAUDE.md, and `conceptExtraction.ts`'s reason for capping a
 * merged definition — while nothing here enforced it. What actually kept full
 * mode inside the ceiling was the client sending exactly one material.
 *
 * Gemini's window makes the old figure meaningless (`gemini-3.5-flash-lite` takes
 * ~1M input tokens), but "no limit" is not the lesson: an unbounded context is an
 * unbounded bill and an unbounded latency. 32,000 characters is ~8,000 tokens —
 * about five times what Groq would accept, and comfortably above the worst case
 * real data can produce, since a material tops out near 42 concepts and
 * `MAX_MERGED_DEFINITION_CHARS` caps each definition at 800 (≈33,600 characters,
 * and only if every single definition were at its cap).
 *
 * So this is a runaway guard, not a working constraint: on today's data nothing
 * reaches it. If it ever starts firing, that is the signal that full mode is
 * being pointed at more than one material.
 */
const MAX_CONTEXT_CHARS = 32_000;

/**
 * Output ceiling for one reply.
 *
 * DOUBLED from Groq's 2048, for the reason every migrated call was: MINIMAL
 * thinking is not *no* thinking and Gemini 3 thinking tokens draw on the same
 * budget. Truncation is worse here than anywhere else in the app — it throws
 * nothing and parses nothing, it simply stops the answer mid-sentence in front of
 * the student. `streamContent()` logs a MAX_TOKENS finish for that reason.
 */
const MAX_REPLY_TOKENS = 4096;

/**
 * Trims the knowledge base to `MAX_CONTEXT_CHARS`.
 *
 * Drops WHOLE concepts from the end — never mid-definition, and never reordering
 * — so what survives is the front of the document, matching how
 * `conceptExtraction.ts` truncates a merged definition. It trims the concept list
 * itself rather than the rendered string, so `source_concept_ids` records what
 * genuinely grounded the answer instead of what was fetched.
 */
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
 * Detects "document-level" requests — ones that ask about the material as a whole
 * (summarize, explain the file, overview, key points, TL;DR, …) rather than about
 * a specific concept.
 *
 * These phrases carry no topical keywords, so their embeddings are generic and
 * score poorly against individual concept vectors — they'd be wrongly refused by
 * the strict RAG gate. But they ARE on-topic and, like the Summarize / Explain /
 * Key Terms quick-action buttons, belong in 'full' mode (whole document) rather
 * than RAG top-k — provided they actually clear DOC_LEVEL_MATCH_THRESHOLD against
 * the material. We route them there so a typed "summarize this file" behaves the
 * same as clicking the Summarize button.
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

  // ── 1a. Ownership and access ──────────────────────────────────────────────
  // The reply streams back the text of the selected materials, so this is a read
  // of those materials and is gated the same way. Without it, a student could
  // pass any material id and have the assistant recite another grade's content.
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
  // PRE/POST GATE — temporary (migration 0024). Runs AFTER the access check, never
  // before: that ordering is what lets archiving and re-grading answer first.
  if (!(await rejectLockedMaterials(req, res, material_ids))) return;

  // A typed "summarize this file" arrives as mode 'rag' but is really a
  // whole-document request. We still verify it is anchored to the material below.
  const docLevel = mode === 'rag' && isDocumentLevelRequest(message);

  // ── 2. Retrieve context + decide how to answer ─────────────────────────────
  // Concepts fed to the LLM, and the ids that informed the answer (for logging).
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
        // Whole-document request: answer from the full material only if it is
        // actually about the material. An external subject ("summarize Reply
        // 1988") scores below the gate and is refused.
        if (topSim >= DOC_LEVEL_MATCH_THRESHOLD) {
          useFullMode = true;
        } else {
          refuse = true;
        }
      } else {
        // Specific question: keep only concepts clearing the strict relevance gate.
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
      // FULL MODE: fetch ALL concepts for the selected material (for summaries).
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
    // Mirrors the streaming handler below: a typed Gemini failure keeps its own
    // status, so a spent quota answers 429 rather than being flattened to 500.
    // This branch hardcoded 500 and leaked `err.message` to the student.
    const status = err instanceof GeminiUnavailableError ? err.status : 500;
    res.status(status).json({ error: 'Failed to retrieve context', message: studentFacingError(err) });
    return;
  }

  // ── 2b. Off-topic guard ────────────────────────────────────────────────────
  // The query matched nothing relevant in the selected materials — the student is
  // asking about something they don't cover. Refuse deterministically instead of
  // letting the LLM answer from its own world knowledge.
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

  // ── 3. Build the prompt ────────────────────────────────────────────────────
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

  // Keep last 4 messages of history (2 exchanges) to save tokens.
  // The system prompt is NOT one of them: Gemini has no system role inside
  // `contents`, so it travels separately as the model's system instruction.
  //
  // The identity-looking `.map()` is load-bearing: `tsconfig.json` sets no
  // `strictNullChecks`, under which Zod 3 infers every field of a parsed object as
  // OPTIONAL. An object literal's properties are required, so rebuilding each turn
  // is what makes the array match `StreamContentOptions` without loosening that
  // contract for every future caller.
  const trimmedHistory = history.slice(-4).map(m => ({ role: m.role, content: m.content }));

  // ── 4. Stream the response via SSE ────────────────────────────────────────
  let fullResponse = '';

  try {
    // ⚠️ THE STREAM IS OPENED BEFORE THE HEADERS ARE FLUSHED, DELIBERATELY.
    // `streamContent()` awaits the upstream request, so a refusal — a spent daily
    // quota above all — arrives here while a real HTTP status is still sendable.
    // This route used to flush first, which made the `!res.headersSent` branch
    // below unreachable and turned every refusal, whatever its cause, into the
    // client's generic "something went wrong".
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

    // The wire format is the contract with `ResourcesTab.tsx`, which parses it by
    // hand — the one documented exception to the "never use raw fetch" rule. One
    // `data: {"token":"…"}` per chunk, then `data: {"done":true}`, then end.
    //
    // Gemini writes in larger pieces than llama did — often a sentence at a time
    // rather than a word — so a short reply can arrive in two or three chunks. That
    // is the transport being different, not the streaming having stopped working.
    for await (const token of stream) {
      fullResponse += token;
      res.write(`data: ${JSON.stringify({ token })}\n\n`);
    }

    // Signal stream end
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();

    // ── 5. Save exchange to chatbot_logs ─────────────────────────────────────
    if (userId && fullResponse) {
      // Record which concepts grounded this answer: the retrieved top-k in RAG
      // mode, or every loaded concept in full mode.
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

      /*
       * Streak + badges. A chat turn counts as study activity because the
       * `activity_type` enum committed to it, and a student whose only session
       * that day was the chatbot should not lose their run for it.
       *
       * It is also by far the cheapest activity to farm, which is why `chat` has
       * no first-time badge of its own and awards nothing but streak progress.
       * Recorded rather than designed around.
       *
       * Only THIS path logs. The off-topic refusal above writes a chatbot_logs
       * row too, but the assistant declined to answer and nothing was studied.
       */
      await logActivity({ studentId: userId, type: 'chat', spaceId: space_id });
    }
  } catch (err: any) {
    console.error('[Chat] Streaming error:', err.message);
    if (!res.headersSent) {
      // Nothing has reached the browser yet, so a real status still can be sent. A
      // typed Gemini failure carries its own: 429 when the allowance is spent, 503
      // for an outage. The client reads `message` off a non-OK response and renders
      // it to the student, so it gets `userMessage`, never `err.message`.
      const status = err instanceof GeminiUnavailableError ? err.status : 500;
      res.status(status).json({ error: 'Streaming failed', message: studentFacingError(err) });
    } else {
      // Mid-stream: the student is already reading a partial answer, so there is no
      // status left to send and no safe way to retry — a second attempt would
      // splice itself into the middle of a sentence.
      // ⚠️ STUDENT COPY, NOT A STATUS. `ResourcesTab` throws on this field and
      // renders the string in its error bar, so "Stream interrupted" was jargon
      // with no action attached. Asking again is the only thing that works here —
      // the answer cannot be resumed, and retrying server-side would splice a
      // second attempt into the middle of a sentence.
      res.write(
        `data: ${JSON.stringify({
          error: 'The answer stopped partway through. Please ask again.',
        })}\n\n`
      );
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
  // Scoped to the caller as well as the space: without student_id, passing another
  // student's space id returned their conversation verbatim.
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
