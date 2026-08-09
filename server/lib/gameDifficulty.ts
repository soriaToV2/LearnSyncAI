import type { DifficultyTier } from './testAllocation';

/**
 * Difficulty calibration for the three games — the Procedural Gamification Engine.
 *
 * Paper p. 83: "This aggregated score is directly utilized by the system's
 * gamification module to calibrate the operational difficulty of generated games
 * (crosswords, term matching, and timed trivia). When a game session is
 * initialized, the system retrieves the current M_doc value from the database and
 * applies it as a baseline parameter to the generative AI prompt. For example, if
 * a student's document mastery sits at exactly 50%, the game engine utilizes this
 * value to restrict the vocabulary complexity, clue difficulty, and trivia
 * response timers to align exactly with that 50% knowledge threshold."
 *
 * Those three levers are, in order: `CROSSWORD_TIER_RULES.answer` and
 * `MATCH_TIER_RULES.selection` (vocabulary complexity), the `clue`/`definition`/
 * `question` fields (clue difficulty), and `TRIVIA_QUESTION_MS` (the timer).
 * Paper p. 58 adds a fourth, "question selection", which is
 * `pickConceptsByMastery()`.
 *
 * ══ GAMES READ MASTERY AND NEVER WRITE IT ══
 * Paper p. 58 (Limitations): AI-generated games "utilize existing mastery
 * estimates only to personalize question selection, generated content, and
 * difficulty level WITHOUT MODIFYING the learner's mastery state." `bkt_mastery`
 * has exactly two writers — `practice.routes.ts` and `flashcards.routes.ts` — and
 * `bkt_source` is a two-value enum for the same reason. Nothing under the games
 * path may import `server/lib/bkt.ts`. There is no `applyGameCompletion` and
 * there must never be one.
 *
 * Tier thresholds, the mean, and the P(L₀) prior all live in `testDifficulty.ts`
 * and are imported by the route, not restated here. Nothing game-shaped goes back
 * the other way.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Question selection — paper p. 58
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What an unassessed concept counts as WHEN CHOOSING WHAT TO PRACTISE.
 *
 * ⚠️ AN UNASSESSED CONCEPT IS 0.50 HERE AND P(L₀) = 0.10 INSIDE
 * `documentMastery()`, AND THAT DISAGREEMENT IS DELIBERATE.
 *
 * EQ(4) estimates what the student knows, so a concept nobody has measured must
 * enter it at the prior — anything else would invent evidence. Selection asks a
 * different question: what is worth practising? There the prior is wrong twice
 * over. The BKT transition step floors every posterior at P(T) = 0.20, so a
 * concept the student is measurably failing sits at 0.20–0.30 while one nobody
 * has ever asked about sits at 0.10. Ranking by raw mastery would therefore put
 * every untouched concept ABOVE every struggling one, and on a 57-concept lesson
 * with six assessed, all fourteen trivia slots would go to concepts the student
 * has never seen — mastery would change nothing at all.
 *
 * 0.50 is neutral: strictly below any weak-assessed concept's weight and strictly
 * above any strong one's, giving known weak > unknown > known strong. The same
 * reasoning is already written down in CLAUDE.md's Analytics rule and in
 * `practice.routes.ts`'s concept sort. Do not "fix" this to P_L0.
 */
export const NEUTRAL_MASTERY = 0.5;

/**
 * The pull a fully mastered concept keeps, so it can still turn up occasionally.
 *
 * Without a floor, mastery 0.9999 gives weight 1e-4 against a weak concept's 0.8
 * — a ratio of 8000:1, i.e. never. A student who has mastered a lesson should
 * still sometimes be shown it; a game they can win is not a bug. The floor also
 * bounds the A-Res exponent (see `pickConceptsByMastery`).
 */
const WEIGHT_FLOOR = 0.05;

/**
 * How much this concept wants to be practised. Decreasing in mastery, never zero.
 *
 * `undefined` means no `bkt_mastery` row — see `NEUTRAL_MASTERY`. The absence is
 * the signal, which is why `masteryRows()` leaves unassessed concepts out of its
 * map rather than defaulting them.
 */
export function selectionWeight(mastery: number | undefined): number {
  const m = mastery ?? NEUTRAL_MASTERY;
  if (!Number.isFinite(m)) return 1 - NEUTRAL_MASTERY;
  return Math.max(1 - Math.min(Math.max(m, 0), 1), WEIGHT_FLOOR);
}

/**
 * Weighted sampling WITHOUT replacement — Efraimidis–Spirakis A-Res.
 *
 * Each item draws `key = U^(1/w)`; the largest n keys are the sample. One pass,
 * no renormalising, no mutation, and the first draw is exactly proportional to
 * weight. This replaces the uniform Fisher-Yates shuffle whose own comment asked
 * for it.
 *
 * WHY NOT THE ALTERNATIVES.
 *   - Sort ascending by mastery, take n: deterministic, so "Play Again" rebuilds
 *     a byte-identical game from the identical concepts. Replay variety is the
 *     whole reason the shuffle was there.
 *   - Stratified quotas (k weak / j unknown / i strong): needs a table per game,
 *     degrades badly when a lesson has no concepts in a stratum, and fixes the
 *     COMPOSITION — a student with thirty weak concepts should sometimes get a
 *     different eight of them, which quotas do not give.
 *   - Roulette-wheel with removal: same distribution, but O(n·N) and it mutates
 *     the candidate array.
 *
 * NUMERICS. `Math.random()` can return exactly 0 and `0^(1/w)` is 0 — a valid
 * worst key rather than NaN, but ties at 0 sort arbitrarily, so it is nudged to
 * the smallest positive double. With WEIGHT_FLOOR = 0.05 the exponent never
 * exceeds 20 and `0.5^20 ≈ 9.5e-7`, far from denormal, so no key underflows to 0
 * and collapses the ordering. If that ever needs revisiting, raise the floor —
 * never the exponent.
 *
 * PURE ON PURPOSE. It takes the mastery map rather than fetching it, so the
 * weighting is verifiable with no network and no database, and one
 * `masteryRows()` call feeds both EQ(4) and the selection.
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

  // Sort even when everything already fits. The buffers below deliberately exceed
  // each game's output — eighteen concepts become eight to twelve crossword words
  // — so the MODEL makes the final cut, and the order it reads them in is the
  // last lever available. (A behaviour change from the old `pickConcepts`, which
  // early-returned unsorted whenever `concepts.length <= n`.)
  keyed.sort((a, b) => b.key - a.key);
  return keyed.slice(0, Math.max(0, n)).map((k) => k.concept);
}

/**
 * How many concepts each game hands the model.
 *
 * Every buffer is larger than the game's output so the model still has room to
 * pick the best items — and, since `pickConceptsByMastery()` orders them, that
 * surplus is what carries the mastery signal past the code and into the
 * generation. The crossword gets the widest because its layout needs interlocking
 * candidates to choose from.
 */
export const SELECT_BUFFER: Record<string, number> = {
  term_matcher: 8, // → 4 pairs
  timed_trivia: 14, // → 10 questions
  crossword: 18, // → 8–12 words, placed into the grid
};

// ─────────────────────────────────────────────────────────────────────────────
// The timer — paper p. 83's third named lever
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Milliseconds on the clock for one Timed Trivia question, by tier.
 *
 * SERVER-AUTHORITATIVE. Written into `game_content.payload.settings` at
 * generation and obeyed by the client. The difficulty of a timed game IS its
 * timer, so a client-side derivation would be a client-chosen difficulty — the
 * same reasoning as `testAllocation.ts` re-deriving test length server-side.
 *
 * Storing it rather than deriving it also means a stored game replays exactly as
 * generated. Change these numbers later and every previously generated game keeps
 * the clock its questions were written for; a derived timer would silently
 * re-time them all, and the payload would stop describing the game it produced.
 * `practice_tests.questions_payload` sets the same precedent.
 *
 * There is deliberately NO `src/lib/` mirror. `reviewSchedule.ts` and
 * `testMode.ts` are mirrored because a SETUP SCREEN must preview a value before
 * the server has spoken; by the time a trivia game mounts, the server has already
 * spoken, so a mirror would be a second copy of a rule with no job.
 *
 * 15s is the intermediate value because it is what the game shipped with, and
 * because the paper's worked example is a student at exactly 50% — the bottom of
 * the intermediate band.
 */
export const TRIVIA_QUESTION_MS: Record<DifficultyTier, number> = {
  foundational: 20_000,
  intermediate: 15_000,
  advanced: 10_000,
};

// ─────────────────────────────────────────────────────────────────────────────
// Prompt guidance — one table per game, three tiers each
// ─────────────────────────────────────────────────────────────────────────────

/**
 * WHY EACH TABLE HAS A `focus` PARAGRAPH *AND* FIELDS SPLICED ONTO THE BULLETS.
 *
 * `testDifficulty.ts` records the measurement this file is built on. With the
 * tier sitting only in a shared header, true/false questions came back
 * BYTE-IDENTICAL across all three tiers — even on the corpus's richest
 * 643-character concept, so it was not the source material running out. The rules
 * immediately after the header were specific and imperative, and they won.
 *
 * So the tier text REPLACES the operative rule lines rather than decorating them,
 * exactly as `TF_TIER_RULES` replaces the "VERDICT: TRUE" line over there. Each
 * cell names a concrete change of TASK — recall it, apply it, reason about what
 * happens when it fails — not an adjective like "harder".
 *
 * `TIER_GUIDANCE` (the paper's own p. 81 framing of what a tier means) is
 * imported and reused by the prompts rather than restated here: it is a quotation
 * about the student's state, and it is as true of a crossword as of a test.
 * Everything below is game-specific.
 *
 * ⚠️ THE SOURCE MATERIAL IS STILL THE REAL CEILING, exactly as for tests. A
 * concept defined in fifteen words cannot support an advanced clue no matter how
 * the prompt is worded. Expect advanced to reach on richly-defined concepts and
 * to collapse toward intermediate on thin ones — that is a property of the
 * lesson, and it belongs in the write-up rather than being prompted around.
 */

/**
 * CROSSWORD — `answer` is the paper's "vocabulary complexity" lever, `clue` its
 * "clue difficulty" lever, and BOTH are needed.
 *
 * A hard clue pointing at the concept's own name is still an easy crossword: the
 * grid gives away the length and the interlocks give away the letters, so a
 * student who recognises the term fills it in without reading the clue. Moving
 * the ANSWER off the term name is what actually raises the difficulty.
 *
 * Nothing in `FORMAT_TIER_GUIDANCE` corresponds to this task — a practice test
 * never asks a student to produce a single word under a letter-count constraint —
 * so there is nothing to reuse.
 */
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

/**
 * TERM MATCHING — two levers, and only one of them exists in Test Mode.
 *
 * `definition` is deliberately PARALLEL to `FORMAT_TIER_GUIDANCE.matching_type`
 * ("a plain, literal restatement" / "what the term is FOR" / "the effect it has")
 * so the game and the test cannot drift into contradicting each other about what
 * a matching item is at each tier.
 *
 * It is paralleled rather than imported because the game needs a second clause
 * the test must not have: WHICH TERMS go on the board. A practice test has no
 * such choice — `allocateConcepts()` emits one question for every concept — while
 * the game shows four of eight, and "vocabulary complexity" (p. 83) is precisely
 * that choice.
 */
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
 * TIMED TRIVIA — this one CANNOT reuse `FORMAT_TIER_GUIDANCE.multiple_choice`,
 * and the reason is arithmetic rather than taste.
 *
 * That table's `advanced` cell says "Open with a one-sentence scenario, then ask
 * what applies". Advanced trivia runs on a TEN-SECOND clock. A 20-word scenario
 * plus a 12-word question plus four options averaging five words is about 52
 * words; at an on-screen reading rate of roughly four words a second that is
 * thirteen seconds of reading before a single second of thinking. The item would
 * time out on every student regardless of what they know — the exact "cognitive
 * frustration" p. 83 says this feature exists to prevent.
 *
 * So trivia inverts the usual shape: as the tier rises the QUESTION gets SHORTER
 * and the OPTIONS get harder. The difficulty lives entirely in the distractors.
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
   * ⚠️ THE DIFFICULTY IS IN THE DISTRACTORS, AND THAT IS NOT A STYLE PREFERENCE.
   *
   * An earlier version of this cell demanded the QUESTION carry the difficulty:
   * "ask what the term CAUSES, PREVENTS, COSTS or fails to cover". Measured, the
   * model turned those four verbs into a template and used it on all ten items —
   * and forcing a verb onto a concept that cannot support it produced FALSEHOODS:
   * "What does Cross-Site Scripting prevent?" answered "Malicious script
   * execution", which is what XSS *causes*. "What does Physical Layer cost?"
   * answered "Data transmission", which is meaningless. That fails the paper's
   * Factual Correctness criterion (p. 98), which no amount of difficulty buys back.
   *
   * The cause is the ceiling `FORMAT_TIER_GUIDANCE` already documents: most of
   * this corpus is OWASP risk names and OSI layers defined in a line or two, and
   * a one-line definition cannot support a consequence question. Meanwhile the
   * lever that IS available was being wasted — the distractors came back as
   * "Network congestion" and "Hardware replacement", generic strings from outside
   * the lesson that a student eliminates without knowing anything.
   *
   * So this tier asks an ordinary question and puts every gram of difficulty into
   * options drawn from the lesson's OWN neighbouring concepts. That constraint is
   * checkable by the model against the concept list it was given, which is why it
   * holds where "reason about consequences" did not.
   *
   * ACCEPTED LIMIT, MEASURED: about two items in ten still come back definitional
   * ("What is a WEBSITE?"), because some concepts in a lesson genuinely carry
   * nothing but a definition. That is the ceiling, not a prompt bug — every
   * attempt to forbid it produced invented facts instead, and a wrong fact taught
   * confidently costs far more than an easy question. Do not chase the last two.
   */
  advanced: {
    focus:
      "Put the difficulty entirely in the OPTIONS. Every wrong option must be another concept's role " +
      'or effect taken from the SAME lesson, so a student who half-knows the material finds all four ' +
      'plausible and only one is actually right. The question itself stays short and ordinary — the ' +
      'student has ten seconds, and a long question measures reading speed, not knowledge.',
    // Deliberately almost as plain as the intermediate rule. Every attempt to
    // make the QUESTION carry this tier degraded it — into a four-verb template,
    // then into fragments, then into subjectless stems like "Ensures reliable
    // data transfer?" with no concept named at all. The options carry the tier.
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
