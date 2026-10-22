import type { DifficultyTier } from './testAllocation';

/**
 * Difficulty calibration for the three games (paper p. 83): vocabulary complexity, clue
 * difficulty and the trivia timer, plus mastery-weighted question selection (p. 58).
 * Games read mastery and never write it; do not import `bkt.ts` here.
 */

// Question selection (paper p. 58)

/**
 * Weight given to an unassessed concept when choosing what to practise. Intentionally not P(L₀):
 * assessed concepts floor at P(T) = 0.20, so 0.10 would rank every unseen concept above every
 * struggling one. Gives known weak > unknown > known strong.
 */
export const NEUTRAL_MASTERY = 0.5;

/** Keeps mastered concepts reachable and bounds the A-Res exponent at 20. */
const WEIGHT_FLOOR = 0.05;

/** How much a concept should be practised. `undefined` = no mastery row. */
export function selectionWeight(mastery: number | undefined): number {
  const m = mastery ?? NEUTRAL_MASTERY;
  if (!Number.isFinite(m)) return 1 - NEUTRAL_MASTERY;
  return Math.max(1 - Math.min(Math.max(m, 0), 1), WEIGHT_FLOOR);
}

/**
 * Weighted sampling without replacement (Efraimidis–Spirakis A-Res): key = U^(1/w), take the top n.
 * Random rather than sorted so "Play Again" varies. If underflow ever matters, raise WEIGHT_FLOOR,
 * never the exponent.
 */
export function pickConceptsByMastery<T extends { id: string }>(
  concepts: readonly T[],
  byConcept: ReadonlyMap<string, number>,
  n: number
): T[] {
  const keyed = concepts.map((concept) => {
    const weight = selectionWeight(byConcept.get(concept.id));
    const u = Math.random() || Number.MIN_VALUE;
    return { concept, key: Math.pow(u, 1 / weight) };
  });

  // Sort even when everything fits: the model makes the final cut and reads them in this order.
  keyed.sort((a, b) => b.key - a.key);
  return keyed.slice(0, Math.max(0, n)).map((k) => k.concept);
}

/** Concepts handed to the model per game; larger than the output so the model can choose. */
export const SELECT_BUFFER: Record<string, number> = {
  term_matcher: 8, // → 4 pairs
  timed_trivia: 14, // → 10 questions
  crossword: 18, // → 8–12 words, placed into the grid
};

/**
 * Per-question trivia clock by tier. Server-authoritative and stored in the payload,
 * so a stored game replays with the clock it was generated for.
 */
export const TRIVIA_QUESTION_MS: Record<DifficultyTier, number> = {
  foundational: 20_000,
  intermediate: 15_000,
  advanced: 10_000,
};

// Prompt guidance. Tier text replaces the operative rule lines rather than decorating them;
// otherwise output was identical across tiers. See GAMES_CALIBRATION_IMPLEMENTATION.md.

/** `answer` is vocabulary complexity and `clue` is clue difficulty; both are needed. */
export const CROSSWORD_TIER_RULES: Record<
  DifficultyTier,
  { focus: string; answer: string; clue: string }
> = {
  foundational: {
    focus:
      'Every answer must be a word the student has already READ in this lesson, and every clue a ' +
      'plain restatement of the definition it came from. The puzzle should reward recognition, not ' +
      'inference.',
    answer:
      "take the answer from the concept's own NAME — the single most important word in the term itself.",
    clue: 'restate the definition plainly, so the clue and the answer are two forms of one sentence.',
  },
  intermediate: {
    focus:
      'Answers move OFF the concept names and INTO the definitions. The student already knows what ' +
      'each term is called; the puzzle now asks what each term involves.',
    answer:
      'take the answer from inside the DEFINITION — the thing the concept acts on, uses, produces or ' +
      "protects — not from the concept's name.",
    clue:
      'say what that thing is FOR, or where it is used. A student who has only memorised the term ' +
      'names must not be able to reach the answer.',
  },
  advanced: {
    focus:
      'Answers name a CONSEQUENCE, not a thing. The student has mastered the definitions and is now ' +
      'being asked to reason about what happens — what the concept prevents, causes or costs.',
    answer:
      'take the answer from the EFFECT or the FAILURE the concept concerns — what goes wrong without ' +
      'it, or what it produces when it works.',
    clue:
      "describe the SITUATION in which that effect matters, and never mention the concept's name. A " +
      'clue answerable by reading the term alone is an INTERMEDIATE clue and is not acceptable here.',
  },
};

/** `definition` parallels FORMAT_TIER_GUIDANCE.matching_type; `selection` is game-only. */
export const MATCH_TIER_RULES: Record<
  DifficultyTier,
  { focus: string; selection: string; definition: string }
> = {
  foundational: {
    focus:
      'Pick the plainest terms and describe them literally — four cards a student can clear by ' +
      'recognising words they have read.',
    selection:
      'choose the plainest, most concrete terms available — the ones a student meets first in this lesson',
    definition:
      "a literal restatement of what the term IS, in the lesson's own vocabulary.",
  },
  intermediate: {
    focus:
      'Pick terms that sit NEXT TO each other in the lesson, so the four cards are genuinely ' +
      'confusable, and describe each by its purpose rather than by its name.',
    selection:
      'choose terms that are neighbours in this lesson — ideas a student could plausibly mix up with ' +
      'one another',
    definition:
      "what the term is FOR — its purpose, in one short phrase. Never restate the term's own name.",
  },
  advanced: {
    focus:
      'Pick the most technical terms the lesson offers, including ones that are easy to swap, and ' +
      'describe each ONLY by what it achieves.',
    selection:
      'choose the most technical or abstract terms the lesson offers, favouring ones that are easy to ' +
      'confuse with each other',
    definition:
      'the EFFECT the term has, or the problem it prevents. A definition describing what the term IS ' +
      'belongs to a lower tier and is not acceptable here.',
  },
};

/**
 * Cannot reuse FORMAT_TIER_GUIDANCE.multiple_choice: its advanced scenario takes longer to read
 * than the 10s clock. Questions stay short; difficulty lives in the distractors.
 */
export const TRIVIA_TIER_RULES: Record<
  DifficultyTier,
  { focus: string; question: string; options: string }
> = {
  foundational: {
    focus:
      'Ask what each term MEANS. The correct option restates the definition plainly and the wrong ' +
      'options are about clearly different things, so the answer is readable at a glance.',
    question: 'ask what the term MEANS, in at most 12 words.',
    options:
      'must be definitions of clearly DIFFERENT things from elsewhere in the lesson — not near misses.',
  },
  intermediate: {
    focus:
      'Ask which SITUATION is an example of the term, or what it is FOR. The difficulty belongs in ' +
      "the distractors, which are the term's neighbours in this lesson.",
    question:
      'ask which SITUATION is an example of the term, or what it is FOR. Use 8 to 15 words. A ' +
      '"What is X?" or "What does X mean?" question belongs to the tier below and is not acceptable here.',
    options:
      'must be NEIGHBOURING ideas from the same lesson — near misses a student could confuse with the ' +
      'answer, never unrelated topics. Each option is 3 to 10 words; a one-word option is too easy to ' +
      'scan past.',
  },
  /**
   * Difficulty goes in the distractors. Pushing it into the question made the model invent facts
   * (e.g. "What does XSS prevent?"). See CLAUDE.md § Games.
   */
  advanced: {
    focus:
      "Put the difficulty entirely in the OPTIONS. Every wrong option must be another concept's role " +
      'or effect taken from the SAME lesson, so a student who half-knows the material finds all four ' +
      'plausible and only one is actually right. The question itself stays short and ordinary — the ' +
      'student has ten seconds, and a long question measures reading speed, not knowledge.',
    question:
      'NAME THE CONCEPT and ask what it does, allows, or protects against — for example ' +
      '"Which of these does Broken Access Control allow?". Use 6 to 12 words, ending in a question ' +
      'mark. Every question must name the concept it is about; a question with no subject is ' +
      'unanswerable however good the options are. Ask only what the definition supports.',
    options:
      'must EACH be a role, effect or description belonging to a DIFFERENT concept in the list below, ' +
      'so that all four are real things from this lesson and none can be dismissed as unfamiliar. ' +
      'Never invent a generic filler like "network congestion" or "hardware replacement" that the ' +
      'lesson never mentions. Each option is 3 to 8 words.',
  },
};
