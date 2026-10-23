import { Type, ThinkingLevel, type Schema } from '@google/genai';
import { generateJson, GeminiUnavailableError, GEMINI_CONTENT_MODEL } from './gemini';
import { acronymOf } from './conceptExtraction';
import { TIER_GUIDANCE, FORMAT_TIER_GUIDANCE, TF_TIER_RULES } from './testDifficulty';
import { balancedSlots, shuffled } from './answerPlacement';
import {
  MATCH_OPTIONS_PER_BLOCK,
  MATCH_TERMS_PER_BLOCK,
  type AllocationItem,
  type DifficultyTier,
  type QuestionFormat,
} from './testAllocation';

/**
 * Writes a practice test from a material's concepts, one model call per format so each prompt
 * can be tight and a failure stays contained.
 * The model echoes an item number, never a concept id, and every echo is range-checked.
 * The server owns everything that decides a grade; the model only writes prose.
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
  /** The answer key. Stripped before reaching a browser. */
  answer: string;
  explanation: string;
}

/** Concepts per model call. */
const BATCH = 20;

// Text helpers

function shorten(text: string, max: number): string {
  const clean = text.trim().replace(/\s+/g, ' ');
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function termForms(term: string): string[] {
  const bare = term.replace(/\s*\([^)]*\)\s*$/, '').trim();
  const acronym = acronymOf(term);
  return [bare, acronym ?? ''].filter((s) => s.length >= 3);
}

/**
 * Whether text gives the answer away by naming the concept. Leading word boundary only,
 * so "firewalls" matches "firewall"; forms under 3 chars are skipped.
 */
function mentionsTerm(text: string, term: string): boolean {
  return termForms(term).some((form) => new RegExp(`\\b${escapeRe(form)}`, 'i').test(text));
}

/** Hides the term in a fallback built from the definition. */
function withoutTerm(text: string, term: string): string {
  let out = text;
  for (const form of termForms(term)) {
    out = out.replace(new RegExp(`\\b${escapeRe(form)}\\w*`, 'gi'), 'this concept');
  }
  return out.replace(/\s+/g, ' ').trim();
}

// Model plumbing

interface EchoItem {
  n?: unknown;
  [key: string]: unknown;
}

/** Wraps an item shape in `{ items: [...] }`. Structure only; value checks stay in each writer. */
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

/** Nothing here reasons (the server owns every grading decision), so MINIMAL: much faster and cheaper. */
const THINKING = ThinkingLevel.MINIMAL;

/** Output ceiling per batch. Generous because thinking tokens count against it. */
const MAX_OUTPUT_TOKENS: Record<QuestionFormat, number> = {
  multiple_choice: 8192,
  true_or_false: 6144,
  identification: 6144,
  fill_in_the_blank: 6144,
  matching_type: 4096,
};

/**
 * One model call, returning items keyed by position in the batch. Out-of-range echoes are
 * dropped so text can't attach to the wrong concept; the caller falls back.
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
    // Rethrow typed failures unwrapped; failGeneration() needs them to choose 429 vs 503.
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

/** A trailing item number leaked into prose ("…part of n1."). Rejected, not repaired; the item falls back. */
const ORPHAN_INDEX = /\bn\s*\d*\s*[.!?]?\s*$/i;

function looksClean(text: string): boolean {
  return text.length > 0 && !ORPHAN_INDEX.test(text);
}

/** Clips long definitions in prompts to save input tokens. */
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

// The five writers. Each returns text keyed by position in its slice; a missing key means "fall back".

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

// Assembly

/** The educator's definition is the explanation. */
const explain = (c: ConceptForTest) => `${c.term} — ${c.definition}`;

/**
 * Six distinct option texts for a matching block. Answers are stored as option text, so
 * duplicate glosses would make the key ambiguous; collisions fall back to the definition, then the term.
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
 * Builds the whole test: one question per concept, formats written in parallel.
 * Every format has a deterministic fallback so a skipped item never shortens the test.
 */
export async function generateTestQuestions(params: {
  /** The whole lesson, in lesson order: matching decoys and fallback distractors are its neighbours. */
  concepts: ConceptForTest[];
  allocation: AllocationItem[];
  /** Which concepts each section asks about, from assignFormats() (testAssignment.ts). */
  slices: Map<QuestionFormat, ConceptForTest[]>;
  tier: DifficultyTier;
  materialTitle: string;
}): Promise<{ questions: StoredQuestion[]; fallbackCount: number }> {
  const { concepts, allocation, slices, tier, materialTitle } = params;
  const startedAt = Date.now();

  // 1. Sections were dealt by assignFormats(), which rotates each concept across formats. Dealing
  // in lesson order here gave a concept the same format, and so the same P(G), in every test.

  const choice = slices.get('multiple_choice') ?? [];
  const tf = slices.get('true_or_false') ?? [];
  const ident = slices.get('identification') ?? [];
  const fib = slices.get('fill_in_the_blank') ?? [];
  const match = slices.get('matching_type') ?? [];

  // The server sets true/false verdicts: half each, in random order. They used to alternate
  // (True, False, True…) in every stored test, which a student could answer without reading.
  const verdicts = balancedSlots(tf.length, 2).map((s) => s === 0);

  // Decoys come from outside the block; reusing a concept as a decoy emits no telemetry row.
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

  // 2. Write, one call per format in parallel. A per-minute quota refusal is retried as transient.
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

  // Each of A–D holds about a quarter of the correct answers, in random order. The old
  // hash(index) % 4 equalled index % 4 (the multiplier is 1 mod 4), so every test ran A,B,C,D,A…
  const choiceSlots = balancedSlots(choice.length, 4);

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
        options.splice(choiceSlots[i], 0, correct);
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
        // Random per test; a seed of blockIndex repeated the same arrangement in every test of a lesson.
        const options = shuffled(pool);
        const blockId = `block-${blockIndex}`;
        block.terms.forEach((c, i) => {
          push({ ...base(c, format), prompt: c.term, options, blockId, answer: pool[i] });
        });
      }
    }
  }

  console.log(
    `[TestGen] ${questions.length} questions from ${concepts.length} concepts in ` +
      `${((Date.now() - startedAt) / 1000).toFixed(1)}s (${fallbackCount} fallbacks, tier ${tier})`
  );

  return { questions, fallbackCount };
}
