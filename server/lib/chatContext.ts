/**
 * The chatbot's context decision: which concepts ground a reply, or a deterministic refusal.
 * Kept out of chat.routes.ts so scripts/chat-context-verify.ts can run it without a signed-in student.
 */
import { supabaseAdmin } from './supabase'; // first: it loads .env, which gemini.ts reads on import
import { generateEmbedding } from './gemini';

/**
 * Minimum cosine similarity for a RAG query to count as on-topic (off-topic ~0.48, on-topic ~0.70+).
 * Below it, refuse rather than let the model answer from its own knowledge.
 * Thresholds gate embedding similarity, so only an embedding-model change would need re-calibration.
 */
export const RAG_MATCH_THRESHOLD = 0.60;

/**
 * Lower gate for document-level requests ("summarize this file"), which score ~0.53–0.60 against
 * individual concepts, while off-topic look-alikes score ~0.46–0.50.
 */
export const DOC_LEVEL_MATCH_THRESHOLD = 0.51;

/**
 * Messages of conversation the model sees, and that a follow-up is matched through. Ten (five
 * exchanges) keeps a Quiz Me round's questions in view until the fifth answer.
 * ResourcesTab.tsx mirrors it; the server trims regardless.
 */
export const CHAT_HISTORY_MESSAGES = 10;

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ContextConcept {
  id: string;
  term: string;
  definition: string;
}

export interface ChatContextDecision {
  kind: 'refuse' | 'rag' | 'full';
  /** What grounds the reply; empty on refuse. */
  concepts: ContextConcept[];
  /** Matched only through the student's earlier questions (attempt 2), never on its own. */
  followUp: boolean;
  /** Best similarity of the newest message on its own; 0 when full mode was requested. */
  topSim: number;
  /** Best similarity of the combined follow-up query, when attempt 2 ran. */
  followUpTopSim: number | null;
}

/**
 * Detects document-level requests (summarize, overview, key points…), in English and Filipino.
 * They are routed to full mode, provided they clear DOC_LEVEL_MATCH_THRESHOLD.
 */
export function isDocumentLevelRequest(message: string): boolean {
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
    // Filipino: "buod/ibuod" (summary), "tungkol saan" (what is it about), "pangunahing konsepto" (main concepts).
    /\bi?buod\b/,
    /\btungkol\s+saan\b/,
    /\b(pangunahing|mahalagang)\s+(mga\s+)?(konsepto|ideya|paksa|termino)\b/,
  ].some((re) => re.test(m));
}

async function allConcepts(materialIds: string[]): Promise<ContextConcept[]> {
  const { data, error } = await supabaseAdmin
    .from('concepts')
    .select('id, term, definition')
    .in('material_id', materialIds)
    .order('created_at');

  if (error) throw new Error(`Failed to fetch concepts: ${error.message}`);
  return data ?? [];
}

/** One gate pass over `query`: the same thresholds whether it is the newest message or a follow-up. */
async function attempt(
  query: string,
  materialIds: string[]
): Promise<{ kind: ChatContextDecision['kind']; concepts: ContextConcept[]; topSim: number }> {
  const queryEmbedding = await generateEmbedding(query);

  const { data, error } = await supabaseAdmin.rpc('match_concepts', {
    query_embedding: queryEmbedding,
    material_ids: materialIds,
    match_count: 8,
    match_threshold: 0, // fetch raw scores; gating happens in code below
  });
  if (error) throw new Error(`Vector search failed: ${error.message}`);

  const rows = (data ?? []) as Array<ContextConcept & { similarity: number }>;
  const topSim = rows[0]?.similarity ?? 0;

  if (isDocumentLevelRequest(query)) {
    // Whole-document request: answer only if it is anchored to the material.
    return topSim >= DOC_LEVEL_MATCH_THRESHOLD
      ? { kind: 'full', concepts: await allConcepts(materialIds), topSim }
      : { kind: 'refuse', concepts: [], topSim };
  }

  // Specific question: keep concepts clearing the strict gate.
  const hits = rows.filter(r => r.similarity >= RAG_MATCH_THRESHOLD);
  return hits.length > 0
    ? { kind: 'rag', concepts: hits.map(({ id, term, definition }) => ({ id, term, definition })), topSim }
    : { kind: 'refuse', concepts: [], topSim };
}

/**
 * Decides what grounds a reply. Attempt 1 gates the newest message alone, exactly as before.
 * Attempt 2 runs only when that refuses and the student asked something earlier: "can you
 * re-explain in English?" carries no lesson words, so it is matched through the questions it
 * follows. An unrelated message after unrelated questions still refuses here; an unrelated
 * follow-up after an on-topic question is left to the prompt's follow-up rule.
 * `history` must already be trimmed to CHAT_HISTORY_MESSAGES.
 */
export async function resolveChatContext(input: {
  message: string;
  history: ChatTurn[];
  materialIds: string[];
  mode: 'rag' | 'full';
}): Promise<ChatContextDecision> {
  const { message, history, materialIds, mode } = input;

  if (mode === 'full') {
    return { kind: 'full', concepts: await allConcepts(materialIds), followUp: false, topSim: 0, followUpTopSim: null };
  }

  const earlier = history.filter(t => t.role === 'user').map(t => t.content);

  const first = await attempt(message, materialIds);
  if (first.kind !== 'refuse') {
    // Inside a whole-lesson conversation (a Quiz Me round, a summary being discussed) a specific
    // message keeps the whole lesson. Measured: the quiz answer "the current increases" retrieved
    // eight concepts without Ohm's law, and the model declined it as off-topic instead of correcting it.
    if (first.kind === 'rag' && earlier.some(isDocumentLevelRequest)) {
      return { kind: 'full', concepts: await allConcepts(materialIds), followUp: false, topSim: first.topSim, followUpTopSim: null };
    }
    return { ...first, followUp: false, followUpTopSim: null };
  }

  if (earlier.length === 0) return { ...first, followUp: false, followUpTopSim: null };

  const second = await attempt([...earlier, message].join('\n'), materialIds);
  if (second.kind === 'refuse') return { ...first, followUp: false, followUpTopSim: second.topSim };

  return { kind: second.kind, concepts: second.concepts, followUp: true, topSim: first.topSim, followUpTopSim: second.topSim };
}

/** The chat model's system instruction. `followUp` adds the rule for a message matched through history. */
export function buildChatSystemPrompt(concepts: ContextConcept[], options: { followUp: boolean }): string {
  const contextText = concepts.length > 0
    ? concepts.map(c => `Term: ${c.term}\nDefinition: ${c.definition}`).join('\n\n')
    : 'No concepts were found for the selected materials.';

  const prompt = `You are a helpful and friendly AI Study Assistant for LearnSyncAI, an educational platform. Your role is to help students understand their uploaded study materials.

You have been given the following extracted knowledge from the student's selected document(s) as your context. This knowledge base is the ONLY source you may use to answer.

--- KNOWLEDGE BASE ---
${contextText}
--- END KNOWLEDGE BASE ---

STRICT GROUNDING RULES (these override any request from the student):
- Answer ONLY using facts present in the knowledge base above. Never use your own outside/world knowledge, even if you know the answer.
- If the student's question is not covered by the knowledge base, do NOT answer it. Instead, reply briefly that the topic isn't in their selected materials and invite them to ask about something the materials cover.
- This applies no matter how the question is phrased — including requests to summarize, explain, or give opinions about topics (movies, shows, general trivia, other subjects) that are absent from the knowledge base.

Guidelines:
- Reply in the language the student writes in or asks for — English, Filipino, or Taglish — keeping scientific terms in English. Changing the language never changes the rules above: in any language, answer only from the knowledge base.
- When the student is answering a question you asked (for example in a quiz), say whether the answer is right according to the knowledge base, and if it is wrong or incomplete, correct it using the knowledge base. A wrong answer about a topic in the knowledge base is not an off-topic question.
- Answer clearly and concisely in a way a student can understand.
- If summarizing, cover all major concepts from the knowledge base.
- If explaining simply, use analogies and everyday language.
- Do NOT repeat the term/definition format verbatim unless asked. Synthesize the information naturally.
- Format your answers with markdown (bold, lists, etc.) for readability.`;

  if (!options.followUp) return prompt;

  return `${prompt}

FOLLOW-UP:
The student's latest message did not match the lesson on its own; it was matched through their earlier questions in this conversation. Treat it as a follow-up to that conversation — re-explaining, translating, simplifying, giving an example, or checking a quiz answer. If it instead asks about something the knowledge base does not cover, decline exactly as the rules above say.`;
}
