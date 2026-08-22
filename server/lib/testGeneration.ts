import { Type, ThinkingLevel, type Schema } from '@google/genai';
import { generateJson, GeminiUnavailableError, GEMINI_CONTENT_MODEL } from './gemini';
import { acronymOf } from './conceptExtraction';
import { TIER_GUIDANCE, FORMAT_TIER_GUIDANCE, TF_TIER_RULES } from './testDifficulty';
import {
  MATCH_OPTIONS_PER_BLOCK,
  MATCH_TERMS_PER_BLOCK,
  type AllocationItem,
  type DifficultyTier,
  type QuestionFormat,
} from './testAllocation';

/**
 * Writing a practice test from a material's concepts.
 *
 * ONE CALL PER FORMAT, not one call for the whole test. The original reason was
 * that Groq's JSON mode gave no structural guarantee; `responseSchema` now does,
 * so THAT argument is gone — but do not read this as an invitation to merge the
 * five calls, because the decision rests on two reasons a schema does not touch.
 *
 * First, a prompt can be written tightly for ONE question shape in a way it never
 * can for a five-way union: "the clue must NEVER contain the term" is the single
 * most load-bearing line in `writeIdentification`, and it is meaningless to the
 * other four formats. Second, failure stays contained — a fumbled item costs that
 * item a template, not its section.
 *
 * THE MODEL NEVER SEES OR RETURNS A CONCEPT ID. It echoes the item's number
 * within its batch, and that number is range-checked before it is trusted —
 * copied from `generateQuestionsForConcepts()`. The route this replaces asked
 * the model to echo `concept_id` UUIDs and never checked them, which silently
 * attaches a student's mastery to the wrong concept: the single worst failure
 * available to this feature, because nothing downstream can detect it.
 *
 * THE SERVER OWNS EVERYTHING THAT DECIDES A GRADE — the true/false verdict, the
 * position of the correct option, which concepts form a matching block. The
 * model only writes prose.
 */

export interface ConceptForTest {
  id: string;
  term: string;
  definition: string;
}

/** A question as stored in `practice_tests.questions_payload`. Carries the key. */
export interface StoredQuestion {
  index: number;
  concept_id: string;
  concept_term: string;
  format: QuestionFormat;
  difficulty: DifficultyTier;
  prompt: string;
  options?: string[];
  blockId?: string;
  /** The answer key. Stripped before this ever reaches a browser. */
  answer: string;
  explanation: string;
}

/** Concepts per model call, matching the flashcard generator's proven batch size. */
const BATCH = 20;

// ─────────────────────────────────────────────────────────────────────────────
// Text helpers
// ─────────────────────────────────────────────────────────────────────────────

function shorten(text: string, max: number): string {
  const clean = text.trim().replace(/\s+/g, ' ');
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The forms of a term worth checking for in generated text. */
function termForms(term: string): string[] {
  const bare = term.replace(/\s*\([^)]*\)\s*$/, '').trim();
  const acronym = acronymOf(term);
  return [bare, acronym ?? ''].filter((s) => s.length >= 3);
}

/**
 * Does this text give the answer away by naming the concept?
 *
 * The load-bearing validation for identification, fill-in-the-blank and matching
 * glosses. A clue that contains its own answer is not a question, and the model
 * writes one constantly — it reads as helpful.
 *
 * Leading word boundary only, so "firewalls" is caught by "firewall". Terms
 * shorter than three characters are skipped: too short to test without matching
 * inside unrelated words.
 */
/* eslint-disable-next-line -- PRE/POST GATE: the `export` keyword below is the
   only change this file carries for the temporary pre/post-test feature.
   `assessmentGeneration.ts` reuses this rule rather than copying it. Removing
   the feature means deleting the keyword. */
export function mentionsTerm(text: string, term: string): boolean {
  return termForms(term).some((form) => new RegExp(`\\b${escapeRe(form)}`, 'i').test(text));
}

/** Blanks out the term so a fallback built from the definition still hides it. */
function withoutTerm(text: string, term: string): string {
  let out = text;
  for (const form of termForms(term)) {
    out = out.replace(new RegExp(`\\b${escapeRe(form)}\\w*`, 'gi'), 'this concept');
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** Knuth multiplicative hash. Deterministic placement without an obvious cycle. */
const hash = (n: number) => (Math.imul(n, 2654435761) >>> 0);

function seededShuffle<T>(items: T[], seed: number): T[] {
  const out = [...items];
  let state = hash(seed) || 1;
  for (let i = out.length - 1; i > 0; i--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Model plumbing
// ─────────────────────────────────────────────────────────────────────────────

interface EchoItem {
  n?: unknown;
  [key: string]: unknown;
}

/**
 * Wraps one item shape in the `{ "items": [...] }` envelope every prompt asks for.
 *
 * STRUCTURE ONLY, and the distinction is load-bearing. A schema cannot express
 * "n is inside this batch", "the distractors differ from the correct answer" or
 * "the clue does not contain its own answer" — those stay in the range check
 * below and in each writer's validation loop, exactly as when this ran on Groq
 * with no schema at all. Pinning the shape removes a failure mode; it removes no
 * validation.
 */
function itemsSchema(properties: Record<string, Schema>): Schema {
  const keys = Object.keys(properties);
  return {
    type: Type.OBJECT,
    properties: {
      items: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: { n: { type: Type.INTEGER }, ...properties },
          required: ['n', ...keys],
          propertyOrdering: ['n', ...keys],
        },
      },
    },
    required: ['items'],
  };
}

const CHOICE_SCHEMA = itemsSchema({
  question: { type: Type.STRING },
  correct: { type: Type.STRING },
  distractors: { type: Type.ARRAY, items: { type: Type.STRING } },
});
const TRUE_FALSE_SCHEMA = itemsSchema({ statement: { type: Type.STRING } });
const IDENTIFICATION_SCHEMA = itemsSchema({ clue: { type: Type.STRING } });
const FILL_BLANK_SCHEMA = itemsSchema({ sentence: { type: Type.STRING } });
const GLOSS_SCHEMA = itemsSchema({ gloss: { type: Type.STRING } });

/**
 * Nothing here reasons. The model writes prose; the server owns every decision
 * that affects a mark — the true/false verdict, where the correct option sits,
 * which concepts form a matching block — and grading is deterministic in
 * `testGrading.ts`. Measured, `gemini-3.6-flash` runs ~2s at MINIMAL against
 * 5–20s at LOW, and thinking tokens bill at the OUTPUT rate.
 */
const THINKING = ThinkingLevel.MINIMAL;

/**
 * Output ceiling per batch of up to `BATCH` items.
 *
 * DOUBLED from the Groq budgets (4096 / 3072 / 2048) rather than ported across.
 * MINIMAL thinking is not *no* thinking, and Gemini 3 thinking tokens draw on
 * `maxOutputTokens` — a budget sized for the visible output alone comes back with
 * `finishReason=MAX_TOKENS` and no text, which `generateJson()` throws on and
 * `failGeneration()` turns into a 502, costing the whole test. A ceiling is not a
 * reservation, so headroom that goes unused is free.
 */
const MAX_OUTPUT_TOKENS: Record<QuestionFormat, number> = {
  multiple_choice: 8192,
  true_or_false: 6144,
  identification: 6144,
  fill_in_the_blank: 6144,
  matching_type: 4096,
};

/**
 * One model call, returning items keyed by their position in `batch`.
 *
 * The range check on `n` is the whole point: an out-of-range or non-integer echo
 * is dropped rather than being allowed to attach this text to a different
 * concept. A dropped item is not an error — the caller falls back.
 *
 * NO `temperature`. Gemini 3 dropped the sampling parameters, and `generateJson()`
 * strips one loudly if it is passed. The 0.2 that used to sit here was justified
 * by the paper's Content Consistency check (p. 98), which expects "core factual
 * content, terminology, and difficulty level" to be stable across generations —
 * so be precise about what still delivers that, now the knob is gone. SHAPE is
 * pinned by `responseSchema`; FACTUAL CONTENT by the prompt's "use only what each
 * definition states" rule, enforced afterwards by `mentionsTerm()`, `looksClean()`
 * and the distinctness checks; DIFFICULTY by `TIER_GUIDANCE`, chosen server-side
 * from BKT rather than by the model. What was never guaranteed — and is slightly
 * less true now — is that two generations phrase a question the same way. The
 * paper's criterion does not ask for that.
 */
async function askBatch<T>(
  prompt: string,
  batchSize: number,
  label: string,
  maxTokens: number,
  schema: Schema
): Promise<Map<number, T>> {
  let parsed: { items?: EchoItem[] };
  try {
    parsed = await generateJson<{ items?: EchoItem[] }>(prompt, {
      model: GEMINI_CONTENT_MODEL,
      thinkingLevel: THINKING,
      responseSchema: schema,
      maxOutputTokens: maxTokens,
    });
  } catch (err) {
    // A typed Gemini failure passes through UNTOUCHED. `failGeneration()` branches
    // on `instanceof GeminiUnavailableError` to answer 429-with-Retry-After versus
    // 503; wrapping it in a plain Error collapses both into a generic 502 and tells
    // a student to retry immediately when the quota is spent for the day.
    if (err instanceof GeminiUnavailableError) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Test generation failed on ${label}: ${reason}`);
  }

  const byIndex = new Map<number, T>();
  for (const item of parsed?.items ?? []) {
    const n = Number(item?.n);
    if (!Number.isInteger(n) || n < 1 || n > batchSize) continue;
    byIndex.set(n - 1, item as T);
  }
  return byIndex;
}

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/**
 * The model's own item number, leaked into the sentence it was asked to write.
 *
 * Observed live, twice in one run: "…aim to mitigate through various security
 * measures n1." and "…which is part of n." The model is told to echo the number
 * in a field called `n`, and sometimes writes it into the prose as well.
 *
 * REJECTED, NOT REPAIRED. Stripping the token leaves "…which is part of." —
 * grammatical wreckage that still reaches the student. A rejected item falls
 * back to a template, which is always a complete sentence. Only a TRAILING
 * orphan is matched, so a legitimate "n" elsewhere in a sentence is untouched.
 */
const ORPHAN_INDEX = /\bn\s*\d*\s*[.!?]?\s*$/i;

/** Text that is safe to show a student. */
function looksClean(text: string): boolean {
  return text.length > 0 && !ORPHAN_INDEX.test(text);
}

/**
 * Definitions are trimmed on the way INTO a prompt.
 *
 * Not for readability — for tokens. Five calls go out per test, each carrying its
 * whole concept slice, and input is billed by the token against a per-minute quota
 * shared with concept extraction and Feynman grading on the same model. The
 * 643-character outliers in this corpus are worth clipping; the median definition
 * is 162 characters, so this leaves almost everything untouched.
 */
const PROMPT_DEFINITION_CAP = 400;

function conceptLines(slice: ConceptForTest[]): string {
  return slice
    .map((c, i) => `${i + 1}. Term: "${c.term}" — Definition: ${shorten(c.definition, PROMPT_DEFINITION_CAP)}`)
    .join('\n');
}

function header(materialTitle: string, tier: DifficultyTier, format: QuestionFormat): string {
  return `You are writing a practice test for Junior High School students, drawn ONLY from the lesson "${materialTitle}".

${TIER_GUIDANCE[tier]}

FOR THIS SECTION SPECIFICALLY: ${FORMAT_TIER_GUIDANCE[format][tier]}

Use only what each definition states. Never introduce a fact that is not in it.
Never write the item's number inside the question text — it belongs only in the "n" field.`;
}

async function inBatches<T>(
  total: number,
  run: (start: number, size: number) => Promise<Map<number, T>>
): Promise<Map<number, T>> {
  const all = new Map<number, T>();
  for (let start = 0; start < total; start += BATCH) {
    const size = Math.min(BATCH, total - start);
    const chunk = await run(start, size);
    for (const [i, value] of chunk) all.set(start + i, value);
  }
  return all;
}

// ─────────────────────────────────────────────────────────────────────────────
// The five writers. Each returns text keyed by position in its concept slice;
// a missing key means "fall back", never "drop the question".
// ─────────────────────────────────────────────────────────────────────────────

interface ChoiceDraft {
  question: string;
  correct: string;
  distractors: string[];
}

async function writeChoice(
  concepts: ConceptForTest[],
  materialTitle: string,
  tier: DifficultyTier
): Promise<Map<number, ChoiceDraft>> {
  return inBatches(concepts.length, async (start, size) => {
    const slice = concepts.slice(start, start + size);
    const list = conceptLines(slice);

    const prompt = `${header(materialTitle, tier, 'multiple_choice')}

Write one multiple-choice question per numbered item.

For each item produce:
- "question": one sentence asking about the term. Name the term in the question.
- "correct": the right answer in your own words, at most 120 characters.
- "distractors": exactly 3 wrong answers, each at most 120 characters.

Rules:
- Every distractor must be clearly WRONG for this question, yet believable to
  someone who has not studied. Match the correct answer's length and style.
- Never write "all of the above", "none of the above", or a distractor that is
  the correct answer reworded.
- Do not number, letter or order the options — that is handled elsewhere.
- Echo the item's number in "n".

Respond ONLY with valid JSON (no markdown):
{ "items": [ { "n": 1, "question": "...", "correct": "...", "distractors": ["...", "...", "..."] } ] }

Items:
${list}`;

    const raw = await askBatch<{ question: unknown; correct: unknown; distractors: unknown }>(
      prompt,
      size,
      `multiple_choice[${start}]`,
      MAX_OUTPUT_TOKENS.multiple_choice,
      CHOICE_SCHEMA
    );

    const out = new Map<number, ChoiceDraft>();
    for (const [i, item] of raw) {
      const question = str(item.question);
      const correct = str(item.correct);
      const distractors = Array.isArray(item.distractors)
        ? item.distractors.map(str).filter(Boolean)
        : [];
      const distinct = [...new Set(distractors)].filter(
        (d) => d.toLowerCase() !== correct.toLowerCase()
      );
      if (!looksClean(question) || !correct || distinct.length < 3) continue;
      out.set(i, { question, correct, distractors: distinct.slice(0, 3) });
    }
    return out;
  });
}

async function writeTrueFalse(
  concepts: ConceptForTest[],
  verdicts: boolean[],
  materialTitle: string,
  tier: DifficultyTier
): Promise<Map<number, string>> {
  return inBatches(concepts.length, async (start, size) => {
    const slice = concepts.slice(start, start + size);
    const list = slice
      .map(
        (c, i) =>
          `${i + 1}. Term: "${c.term}" — Definition: ${shorten(c.definition, PROMPT_DEFINITION_CAP)}` +
          ` — VERDICT: ${verdicts[start + i] ? 'TRUE' : 'FALSE'}`
      )
      .join('\n');

    const prompt = `${header(materialTitle, tier, 'true_or_false')}

Write one true-or-false statement per numbered item. Each item tells you which
verdict the statement must have.

VERDICT: TRUE  — ${TF_TIER_RULES[tier].whenTrue}
VERDICT: FALSE — ${TF_TIER_RULES[tier].whenFalse}

Rules:
- One sentence. No hedging words like "usually" or "sometimes" that would make
  the verdict arguable.
- Never reveal the verdict in the wording. A FALSE statement must read exactly
  as confidently as a TRUE one.
- Do NOT simply insert "not" to make something false, and never swap in a
  different term's name.
- Echo the item's number in "n".

Respond ONLY with valid JSON (no markdown):
{ "items": [ { "n": 1, "statement": "..." } ] }

Items:
${list}`;

    const raw = await askBatch<{ statement: unknown }>(
      prompt,
      size,
      `true_or_false[${start}]`,
      MAX_OUTPUT_TOKENS.true_or_false,
      TRUE_FALSE_SCHEMA
    );

    const out = new Map<number, string>();
    for (const [i, item] of raw) {
      const statement = str(item.statement);
      if (looksClean(statement)) out.set(i, statement);
    }
    return out;
  });
}

async function writeIdentification(
  concepts: ConceptForTest[],
  materialTitle: string,
  tier: DifficultyTier
): Promise<Map<number, string>> {
  return inBatches(concepts.length, async (start, size) => {
    const slice = concepts.slice(start, start + size);
    const list = conceptLines(slice);

    const prompt = `${header(materialTitle, tier, 'identification')}

Write one clue per numbered item. The student answers by typing the term.

Rules:
- One or two sentences describing what the term is or does.
- The clue must NEVER contain the term, any part of it, or its abbreviation.
  That is the single most important rule here — a clue containing its own answer
  is not a question.
- Make it specific enough that only this term fits.
- Echo the item's number in "n".

Respond ONLY with valid JSON (no markdown):
{ "items": [ { "n": 1, "clue": "..." } ] }

Items:
${list}`;

    const raw = await askBatch<{ clue: unknown }>(
      prompt,
      size,
      `identification[${start}]`,
      MAX_OUTPUT_TOKENS.identification,
      IDENTIFICATION_SCHEMA
    );

    const out = new Map<number, string>();
    for (const [i, item] of raw) {
      const clue = str(item.clue);
      if (looksClean(clue) && !mentionsTerm(clue, slice[i].term)) out.set(i, clue);
    }
    return out;
  });
}

async function writeFillBlank(
  concepts: ConceptForTest[],
  materialTitle: string,
  tier: DifficultyTier
): Promise<Map<number, string>> {
  return inBatches(concepts.length, async (start, size) => {
    const slice = concepts.slice(start, start + size);
    const list = conceptLines(slice);

    const prompt = `${header(materialTitle, tier, 'fill_in_the_blank')}

Write one fill-in-the-blank sentence per numbered item. The missing word is the term.

Rules:
- Put exactly one blank, written as four underscores: ____
- The term must not appear anywhere else in the sentence.
- The surrounding sentence must make the missing term unambiguous — someone who
  studied should be able to fill it without seeing the options.
- One sentence, natural English.
- Echo the item's number in "n".

Respond ONLY with valid JSON (no markdown):
{ "items": [ { "n": 1, "sentence": "A ____ filters network traffic against a set of rules." } ] }

Items:
${list}`;

    const raw = await askBatch<{ sentence: unknown }>(
      prompt,
      size,
      `fill_in_the_blank[${start}]`,
      MAX_OUTPUT_TOKENS.fill_in_the_blank,
      FILL_BLANK_SCHEMA
    );

    const out = new Map<number, string>();
    for (const [i, item] of raw) {
      const sentence = str(item.sentence);
      const blanks = (sentence.match(/_{3,}/g) ?? []).length;
      if (blanks !== 1 || !looksClean(sentence)) continue;
      if (mentionsTerm(sentence, slice[i].term)) continue;
      out.set(i, sentence.replace(/_{3,}/, '____'));
    }
    return out;
  });
}

async function writeGlosses(
  concepts: ConceptForTest[],
  materialTitle: string,
  tier: DifficultyTier
): Promise<Map<number, string>> {
  return inBatches(concepts.length, async (start, size) => {
    const slice = concepts.slice(start, start + size);
    const list = conceptLines(slice);

    const prompt = `${header(materialTitle, tier, 'matching_type')}

Write a very short definition of each numbered term, for a matching exercise.

Rules:
- At most 90 characters. These sit six to a screen and must be scannable.
- It must define the term, not merely mention it.
- NEVER include the term itself or its abbreviation — the student is matching to
  it, so naming it hands over the answer.
- Plain language a 13-year-old reads without effort.
- Echo the item's number in "n".

Respond ONLY with valid JSON (no markdown):
{ "items": [ { "n": 1, "gloss": "..." } ] }

Items:
${list}`;

    const raw = await askBatch<{ gloss: unknown }>(
      prompt,
      size,
      `matching_type[${start}]`,
      MAX_OUTPUT_TOKENS.matching_type,
      GLOSS_SCHEMA
    );

    const out = new Map<number, string>();
    for (const [i, item] of raw) {
      const gloss = str(item.gloss);
      if (looksClean(gloss) && !mentionsTerm(gloss, slice[i].term)) out.set(i, shorten(gloss, 110));
    }
    return out;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Assembly
// ─────────────────────────────────────────────────────────────────────────────

/** The definition is the explanation. Educator text, so it cannot be wrong. */
const explain = (c: ConceptForTest) => `${c.term} — ${c.definition}`;

/**
 * Six option texts for a matching block, guaranteed distinct.
 *
 * Two concepts really do collide: asked for a ≤90-character gloss, both `XSS`
 * and `SQL Injection` came back as "Cyberattack risk", and the block rendered
 * with the same sentence at A and C. That is not cosmetic — an answer is stored
 * as the option's TEXT, so two identical options are one slot as far as both the
 * grader and the exclusive-slot UI are concerned, and whichever the student
 * picks grades the same. The correct answer becomes ambiguous.
 *
 * On a collision, fall back to the concept's own definition, which is unique per
 * row by construction. The last resort appends the term, which is ugly but can
 * never collide — and a slightly clumsy option beats an ungradeable one.
 */
function distinctPool(concepts: ConceptForTest[], glossOf: Map<string, string>): string[] {
  const used = new Set<string>();
  return concepts.map((c) => {
    const candidates = [
      glossOf.get(c.id) ?? '',
      shorten(withoutTerm(c.definition, c.term), 110),
      `${shorten(withoutTerm(c.definition, c.term), 80)} (${c.term})`,
    ];
    const pick = candidates.find((text) => text && !used.has(text.toLowerCase())) ?? `${c.term}`;
    used.add(pick.toLowerCase());
    return pick;
  });
}

/**
 * Builds the whole test.
 *
 * Concepts are consumed one per question in the order given, so no concept can
 * appear twice — see `allocateConcepts`. The five format writers run in
 * parallel; batches within a format stay sequential.
 *
 * EVERY FORMAT HAS A DETERMINISTIC FALLBACK. A model that skips an item must not
 * shorten the test, because the test length is "one question per concept" and a
 * short test silently breaks that invariant along with the BKT coverage it buys.
 */
export async function generateTestQuestions(params: {
  concepts: ConceptForTest[];
  allocation: AllocationItem[];
  tier: DifficultyTier;
  materialTitle: string;
}): Promise<{ questions: StoredQuestion[]; fallbackCount: number }> {
  const { concepts, allocation, tier, materialTitle } = params;
  const startedAt = Date.now();

  // 1. Deal concepts to sections. One pass, cursor never rewinds.
  const slices = new Map<QuestionFormat, ConceptForTest[]>();
  let cursor = 0;
  for (const { format, count } of allocation) {
    slices.set(format, concepts.slice(cursor, cursor + count));
    cursor += count;
  }

  const choice = slices.get('multiple_choice') ?? [];
  const tf = slices.get('true_or_false') ?? [];
  const ident = slices.get('identification') ?? [];
  const fib = slices.get('fill_in_the_blank') ?? [];
  const match = slices.get('matching_type') ?? [];

  // The server decides every true/false verdict, alternating, so the mix is
  // balanced by construction rather than by asking the model to be fair.
  const verdicts = tf.map((_, i) => i % 2 === 0);

  // Matching blocks need glosses for their distractors too. Distractors are
  // drawn from concepts outside the block — reusing one that carries its own
  // question elsewhere is fine, since a distractor produces no telemetry row.
  const blocks: { terms: ConceptForTest[]; decoys: ConceptForTest[] }[] = [];
  for (let start = 0; start + MATCH_TERMS_PER_BLOCK <= match.length; start += MATCH_TERMS_PER_BLOCK) {
    const terms = match.slice(start, start + MATCH_TERMS_PER_BLOCK);
    const taken = new Set(terms.map((c) => c.id));
    const decoys: ConceptForTest[] = [];
    for (let k = 1; k <= concepts.length && decoys.length < MATCH_OPTIONS_PER_BLOCK - MATCH_TERMS_PER_BLOCK; k++) {
      const candidate = concepts[(concepts.indexOf(terms[0]) + k) % concepts.length];
      if (!taken.has(candidate.id)) {
        taken.add(candidate.id);
        decoys.push(candidate);
      }
    }
    blocks.push({ terms, decoys });
  }
  const glossTargets: ConceptForTest[] = [];
  const glossSeen = new Set<string>();
  for (const b of blocks) {
    for (const c of [...b.terms, ...b.decoys]) {
      if (!glossSeen.has(c.id)) {
        glossSeen.add(c.id);
        glossTargets.push(c);
      }
    }
  }

  // 2. Write. Five calls at most (one per format, more if a format exceeds
  //    BATCH concepts), in parallel. Concurrency is what keeps generation near
  //    single-call latency; a per-minute quota refusal is classified transient
  //    by gemini.ts and retried, so the failure mode is a pause, not an error.
  const [choiceDrafts, tfDrafts, identDrafts, fibDrafts, glossDrafts] = await Promise.all([
    choice.length ? writeChoice(choice, materialTitle, tier) : new Map<number, ChoiceDraft>(),
    tf.length ? writeTrueFalse(tf, verdicts, materialTitle, tier) : new Map<number, string>(),
    ident.length ? writeIdentification(ident, materialTitle, tier) : new Map<number, string>(),
    fib.length ? writeFillBlank(fib, materialTitle, tier) : new Map<number, string>(),
    glossTargets.length ? writeGlosses(glossTargets, materialTitle, tier) : new Map<number, string>(),
  ]);

  const glossOf = new Map<string, string>();
  glossTargets.forEach((c, i) => {
    const drafted = glossDrafts.get(i);
    glossOf.set(c.id, drafted ?? shorten(withoutTerm(c.definition, c.term), 110));
  });

  // 3. Assemble in exam-paper order with sequential indices.
  const questions: StoredQuestion[] = [];
  let fallbackCount = 0;
  const other = (c: ConceptForTest, offset: number) =>
    concepts[(concepts.indexOf(c) + offset) % concepts.length] ?? c;

  const push = (q: StoredQuestion) => questions.push(q);
  const base = (c: ConceptForTest, format: QuestionFormat) => ({
    index: questions.length,
    concept_id: c.id,
    concept_term: c.term,
    format,
    difficulty: tier,
    explanation: explain(c),
  });

  for (const { format } of allocation) {
    if (format === 'multiple_choice') {
      choice.forEach((c, i) => {
        const draft = choiceDrafts.get(i);
        if (!draft) fallbackCount++;
        const question = draft?.question ?? `Which of the following best describes ${c.term}?`;
        const correct = draft?.correct ?? shorten(withoutTerm(c.definition, c.term), 120);
        const distractors =
          draft?.distractors ??
          [1, 2, 3].map((k) => shorten(withoutTerm(other(c, k).definition, other(c, k).term), 120));
        const b = base(c, format);
        const options = [...distractors];
        options.splice(hash(b.index) % 4, 0, correct);
        push({ ...b, prompt: question, options, answer: correct });
      });
    } else if (format === 'true_or_false') {
      tf.forEach((c, i) => {
        const wantTrue = verdicts[i];
        const drafted = tfDrafts.get(i);
        if (!drafted) fallbackCount++;
        const statement =
          drafted ??
          (wantTrue
            ? `${c.term}: ${shorten(c.definition, 160)}`
            : `${c.term} means: ${shorten(other(c, 1).definition, 160)}`);
        push({ ...base(c, format), prompt: statement, answer: wantTrue ? 'true' : 'false' });
      });
    } else if (format === 'identification') {
      ident.forEach((c, i) => {
        const drafted = identDrafts.get(i);
        if (!drafted) fallbackCount++;
        push({
          ...base(c, format),
          prompt: drafted ?? withoutTerm(c.definition, c.term),
          answer: c.term,
        });
      });
    } else if (format === 'fill_in_the_blank') {
      fib.forEach((c, i) => {
        const drafted = fibDrafts.get(i);
        if (!drafted) fallbackCount++;
        push({
          ...base(c, format),
          prompt: drafted ?? `${shorten(withoutTerm(c.definition, c.term), 180)} This is called ____.`,
          answer: c.term,
        });
      });
    } else {
      for (const block of blocks) {
        const pool = distinctPool([...block.terms, ...block.decoys], glossOf);
        const blockIndex = questions.length;
        const options = seededShuffle(pool, blockIndex);
        const blockId = `block-${blockIndex}`;
        block.terms.forEach((c, i) => {
          push({ ...base(c, format), prompt: c.term, options, blockId, answer: pool[i] });
        });
      }
    }
  }

  // One line per test, not per call. Generation is the slowest thing a student
  // waits on in the whole app and the only place its cost is visible, so the log
  // has to state it; measured 47s and 102s on a 42-concept material, against the
  // ~2s a single small Gemini call takes. The spread is the model's output speed
  // on the multiple-choice batch, which every other format finishes inside.
  console.log(
    `[TestGen] ${questions.length} questions from ${concepts.length} concepts in ` +
      `${((Date.now() - startedAt) / 1000).toFixed(1)}s (${fallbackCount} fallbacks, tier ${tier})`
  );

  return { questions, fallbackCount };
}
