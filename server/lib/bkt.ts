/**
 * Bayesian Knowledge Tracing — the classical four-parameter model, implemented
 * directly in this backend.
 *
 * Paper p. 68: "Within LearnSync AI, the four-parameter update equations are
 * implemented directly in the platform backend." There is no pyBKT, no external
 * library, and no Expectation Maximization parameter fitting — p. 70 rules EM out
 * explicitly because the platform has no historical interaction data to fit to.
 *
 * ── The two-phase update, per observation (paper p. 69, EQ 1/2/3) ────────────
 *
 *   Evidence phase
 *     correct    P(Lt | obs=1) = P(Lt)(1-P(S)) / [ P(Lt)(1-P(S)) + (1-P(Lt))P(G) ]
 *     incorrect  P(Lt | obs=0) = P(Lt)P(S)     / [ P(Lt)P(S)     + (1-P(Lt))(1-P(G)) ]
 *
 *   Transition phase
 *     P(Lt+1) = P(Lt | obs) + (1 - P(Lt | obs)) P(T)
 *
 * The value persisted as `latent_mastery` and aggregated by EQ(4) is the
 * POST-TRANSITION one — paper p. 81: "The active value referenced in this
 * aggregation is the most recently computed and saved P(L t+1)".
 *
 * ── Only two writers, ever ───────────────────────────────────────────────────
 *
 * Paper p. 58: "Student mastery estimates are updated exclusively through their
 * performance in Adaptive Flashcards and Adaptive Test Mode." Games, Free Recall
 * and the Feynman technique READ mastery to personalise and must never write it.
 * The `bkt_source` enum ('flashcard' | 'adaptive_test') encodes that at the
 * database level; do not add a third value.
 *
 * ── Three behaviours that look like bugs and are not ─────────────────────────
 *
 * 1. GETTING EVERYTHING WRONG RAISES MASTERY. `posterior = e + (1-e)T` is
 *    increasing in `e` and bottoms out at exactly P(T) = 0.20 when `e` = 0 —
 *    which is ABOVE the 0.10 unassessed prior. Twelve wrong multiple-choice
 *    answers run 0.10 → 0.2174 → 0.2421 → 0.2480 → … → 0.2500. That limit is the
 *    root of 4L² − 5L + 1 = 0; for true/false (7L² − 9L + 2 = 0) it is 2/7.
 *    The model is saying "the student had a learning opportunity, so P(knows)
 *    rose despite weak evidence", which is what a non-zero learning rate means.
 *    Both limits sit below the 0.50 tier threshold, so failure cannot buy a
 *    harder test.
 *
 * 2. THE FLASHCARD PATH MOVES FAR FASTER THAN THE TEST PATH. With P(G_easy) =
 *    0.05 a concept goes 0.10 → 0.7231 → 0.9824 on two Easy ratings, clearing
 *    `advanced` — against 0.7685 for two correct MCQs and 0.3271 for one correct
 *    true/false. That is exactly what a 0.05 guess rate means and the paper
 *    specifies it (p. 72). The brake is the due-check in the rating route: Easy
 *    pushes the card seven days out.
 *
 * 3. MASTERY IS CLAMPED BELOW 1, NOT AT 1. See MASTERY_CEILING.
 */

import { supabaseAdmin } from './supabase';
import type { EaseRating } from './reviewSchedule';
import type { QuestionFormat } from './testAllocation';

// ─────────────────────────────────────────────────────────────────────────────
// Parameters
// ─────────────────────────────────────────────────────────────────────────────

export type GuessKey =
  | 'g_mc'
  | 'g_tf'
  | 'g_id'
  | 'g_fib'
  | 'g_match'
  | 'g_easy'
  | 'g_medium'
  | 'g_hard';

export interface BktParameters {
  /** P(L₀) — prior for a concept never assessed. */
  pL0: number;
  /** P(T) — learning rate per opportunity. */
  pT: number;
  /** P(S) — slip: knows it, answers wrong anyway. */
  pS: number;
  /** P(G) per assessment context. Never one fixed value — paper p. 72. */
  guess: Readonly<Record<GuessKey, number>>;
}

/**
 * The eleven seeded rows of `bkt_parameters`, as literals.
 *
 * Used ONLY as a per-key fallback when the table cannot be read or a key is
 * missing, which is corruption rather than configuration. A missing reference row
 * must not stop knowledge tracing for a live student, but it must be loud — see
 * `loadBktParameters`.
 *
 * Paper pp. 70-76: the literature supplies LIMITS, not values (Corbett & Anderson
 * P(G) < 0.30; Beck & Chang P(G) + P(S) < 1; Baker et al. P(G) < 0.50, all as
 * cited in Šarić-Grgić et al., 2024). These are selected configuration values
 * verified to fall inside those limits, not values converged on from data.
 */
export const BKT_FALLBACK_PARAMETERS: Readonly<BktParameters> = Object.freeze({
  pL0: 0.1,
  pT: 0.2,
  pS: 0.15,
  guess: Object.freeze({
    g_mc: 0.25, //     4 options → 1/4
    g_tf: 0.5, //      binary    → 1/2
    g_id: 0.05, //     open-ended, negligible guessing
    g_fib: 0.05, //    free recall, no selectable options
    g_match: 0.17, //  1 of 6 definitions, "applied per matched item" (p. 75)
    g_easy: 0.05, //   high confidence → correct reflects real knowledge
    g_medium: 0.25, // moderate chance of partial guessing
    g_hard: 0.1, //    recorded as INCORRECT; the low value makes the drop steep
  }),
});

const GUESS_KEYS = Object.keys(BKT_FALLBACK_PARAMETERS.guess) as GuessKey[];

let cachedParameters: BktParameters | null = null;
let inflightLoad: Promise<BktParameters> | null = null;

/**
 * Read the parameter set from `bkt_parameters`, cached for the process lifetime.
 *
 * No TTL, deliberately. Paper p. 75: "The four parameters P(L₀), P(T), P(S) and
 * P(G) never change. They control how each update works and remain constant for
 * as long as the system runs." There is no admin UI that edits this table, and a
 * mid-session refresh would let one student's audit trail be internally
 * inconsistent — half computed under one P(S), half under another.
 *
 * A bad or missing key falls back per-key and logs at error level. It never
 * throws: knowledge tracing degrading to the documented defaults beats a student
 * losing their evidence. The log line is what separates "an admin changed a row"
 * from "the row is gone".
 */
export async function loadBktParameters(opts?: { force?: boolean }): Promise<BktParameters> {
  if (!opts?.force && cachedParameters) return cachedParameters;
  if (!opts?.force && inflightLoad) return inflightLoad;

  inflightLoad = (async (): Promise<BktParameters> => {
    const { data, error } = await supabaseAdmin.from('bkt_parameters').select('key, value');

    if (error) {
      console.error(
        `[BKT] Could not read bkt_parameters (${error.message}) — using the documented defaults. ` +
          `Every update will still compute, but verify the table exists and is seeded.`
      );
      return BKT_FALLBACK_PARAMETERS;
    }

    const raw = new Map<string, unknown>();
    for (const row of data ?? []) raw.set(String(row.key), row.value);

    /*
     * Never `Number(v) || fallback`. The CHECK on `bkt_parameters.value` is
     * `>= 0 AND <= 1` inclusive, so an admin may legitimately set a guess
     * probability to exactly 0 — and `||` would silently swap it for 0.05.
     */
    const read = (key: string, fallback: number): number => {
      if (!raw.has(key)) {
        console.error(`[BKT] bkt_parameters is missing "${key}" — falling back to ${fallback}.`);
        return fallback;
      }
      const value = Number(raw.get(key));
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        console.error(
          `[BKT] bkt_parameters."${key}" is ${String(raw.get(key))}, which is not a probability — ` +
            `falling back to ${fallback}.`
        );
        return fallback;
      }
      return value;
    };

    const guess = {} as Record<GuessKey, number>;
    for (const key of GUESS_KEYS) guess[key] = read(key, BKT_FALLBACK_PARAMETERS.guess[key]);

    const params: BktParameters = {
      pL0: read('p_l0', BKT_FALLBACK_PARAMETERS.pL0),
      pT: read('p_t', BKT_FALLBACK_PARAMETERS.pT),
      pS: read('p_s', BKT_FALLBACK_PARAMETERS.pS),
      guess: Object.freeze(guess),
    };

    /*
     * `testDifficulty.P_L0` is a compile-time constant because the difficulty
     * tier must not sit behind a network read whose failure would change the
     * tier. This assert is what keeps the two honest without coupling them.
     */
    if (params.pL0 !== 0.1) {
      console.error(
        `[BKT] bkt_parameters.p_l0 is ${params.pL0} but testDifficulty.P_L0 is 0.1. ` +
          `Unassessed concepts and assessed ones are now being scored against different priors.`
      );
    }

    // Beck & Chang's degeneracy rule (paper p. 74). A set that fails it can
    // lower mastery after a correct answer, which is silently nonsensical.
    for (const key of GUESS_KEYS) {
      if (guess[key] + params.pS >= 1) {
        console.error(
          `[BKT] Degenerate parameters: ${key} (${guess[key]}) + p_s (${params.pS}) >= 1. ` +
            `Beck & Chang require P(G) + P(S) < 1; mastery may fall after a correct answer.`
        );
      }
    }

    cachedParameters = params;
    return params;
  })().finally(() => {
    inflightLoad = null;
  });

  return inflightLoad;
}

// ─────────────────────────────────────────────────────────────────────────────
// The pure core
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mastery is held strictly inside (0, 1) rather than clamped to [0, 1].
 *
 * At exactly 1.0 the model becomes ABSORBING: an incorrect answer computes
 * `den = 1·P(S) + 0·(1-P(G)) = P(S)` and therefore `evidence = P(S)/P(S) = 1`, so
 * the concept can never be marked as not-known again, by any evidence, forever.
 * Thirteen consecutive Easy flashcard ratings reach exactly 1.0 in float (28 for
 * multiple choice, 52 for true/false), so this is reachable in one term.
 *
 * Continuous BKT asymptotes toward 1 and never arrives; the absorbing state is a
 * floating-point artifact, not a property of the model. Holding one ULP-ish
 * distance away restores the "never certain" behaviour and costs nothing —
 * 1e-9 is far below the paper's ±0.01 tolerance and below the 4dp the UI rounds
 * to, so no hand-computed test case can see it.
 */
const MASTERY_FLOOR = 1e-9;
const MASTERY_CEILING = 1 - 1e-9;

function clampMastery(value: number): number {
  if (!Number.isFinite(value)) return MASTERY_FLOOR;
  if (value < MASTERY_FLOOR) return MASTERY_FLOOR;
  if (value > MASTERY_CEILING) return MASTERY_CEILING;
  return value;
}

export interface BktStepInput {
  prior: number;
  correct: boolean;
  pGuess: number;
  pSlip: number;
  pTransit: number;
}

/** One complete two-phase update, with every value the audit trail needs. */
export interface BktStep {
  /** P(Lt), after clamping. */
  prior: number;
  observation: 0 | 1;
  pGuess: number;
  pSlip: number;
  pTransit: number;
  /** EQ(1) or EQ(2) — the evidence phase. */
  evidence: number;
  /** EQ(3) — the transition phase. This is what gets persisted. */
  posterior: number;
}

/**
 * The whole algorithm. Pure, synchronous, no I/O — which is what lets the ICR
 * harness verify it against hand computation without a database.
 *
 * Returns the full step rather than a bare number so `bkt_update_logs` is a
 * spread and the harness can print the evidence phase alongside the posterior,
 * the way the paper's worked example does.
 */
export function bktStep(input: BktStepInput): BktStep {
  const prior = clampMastery(input.prior);
  const { correct, pGuess, pSlip, pTransit } = input;

  const numerator = correct ? prior * (1 - pSlip) : prior * pSlip;
  const denominator = correct
    ? prior * (1 - pSlip) + (1 - prior) * pGuess
    : prior * pSlip + (1 - prior) * (1 - pGuess);

  /*
   * A zero denominator means the model assigns zero likelihood to this
   * observation under BOTH hypotheses, so the observation carries no
   * information and the Bayesian answer is to keep the prior. Reachable when
   * P(G) is 0 and mastery is 0, both of which the CHECK constraints permit.
   * Written `!(x > 0)` so NaN takes this branch too.
   */
  const evidence = !(denominator > 0) ? prior : clampMastery(numerator / denominator);
  const posterior = clampMastery(evidence + (1 - evidence) * pTransit);

  return {
    prior,
    observation: correct ? 1 : 0,
    pGuess,
    pSlip,
    pTransit,
    evidence,
    posterior,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Context → P(G)
// ─────────────────────────────────────────────────────────────────────────────

/*
 * Exhaustive Records rather than switches: `tsc --noEmit` then fails the build
 * if `QuestionFormat` or `EaseRating` ever gains a member, which is the guard
 * that actually matters. A format silently defaulting to some other format's
 * P(G) would corrupt mastery with nothing to notice it.
 */

/** Paper pp. 73-75. Matching is per matched item, and Test Mode emits one row per term. */
export const GUESS_KEY_BY_FORMAT: Readonly<Record<QuestionFormat, GuessKey>> = Object.freeze({
  multiple_choice: 'g_mc',
  true_or_false: 'g_tf',
  identification: 'g_id',
  fill_in_the_blank: 'g_fib',
  matching_type: 'g_match',
});

/** Paper p. 72. */
export const GUESS_KEY_BY_RATING: Readonly<Record<EaseRating, GuessKey>> = Object.freeze({
  easy: 'g_easy',
  medium: 'g_medium',
  hard: 'g_hard',
});

/**
 * Paper pp. 78-79: Easy and Medium both "record a correct answer (obs = 1)";
 * Hard "records an incorrect answer (obs = 0)". Hard is not a weaker correct —
 * it is a wrong answer with a low guess rate, which is what makes the drop steep.
 */
export const OBSERVATION_BY_RATING: Readonly<Record<EaseRating, 0 | 1>> = Object.freeze({
  easy: 1,
  medium: 1,
  hard: 0,
});

// ─────────────────────────────────────────────────────────────────────────────
// Observations and the orchestrator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One learning opportunity — paper p. 71: "a learning opportunity is a flashcard
 * review or a single test item".
 *
 * A discriminated union, not one flat shape, and the flashcard arm deliberately
 * carries NO `isCorrect`: it is derived from `OBSERVATION_BY_RATING`, so
 * `{ rating: 'hard', isCorrect: true }` cannot be written at all. The same split
 * guarantees each log row sets exactly one of `question_type` / `rating` — a
 * flashcard row carrying a question type would be nonsense.
 */
export type BktObservation =
  | {
      source: 'adaptive_test';
      conceptId: string | null;
      questionType: QuestionFormat;
      isCorrect: boolean;
      practiceTestId: string;
      questionIndex: number;
    }
  | {
      source: 'flashcard';
      conceptId: string | null;
      rating: EaseRating;
      flashcardId: string;
    };

export interface BktUpdateOutcome {
  conceptId: string;
  /** P(L) before this batch — the 0.10 prior when the concept had no row. */
  priorBefore: number;
  /** P(L) after the batch, as persisted. */
  mastery: number;
  observations: number;
  opportunityCount: number;
}

export interface BktApplyResult {
  updated: BktUpdateOutcome[];
  skipped: { conceptId: string | null; reason: 'no_concept' | 'concept_missing' }[];
  /** Non-null when `bkt_mastery` could not be written. Nothing was persisted. */
  masteryWriteError: string | null;
  /** Non-null when the audit rows failed. Mastery IS persisted. */
  logWriteError: string | null;
}

/**
 * A fresh empty result.
 *
 * A function rather than a shared constant on purpose: spreading a constant
 * (`{ ...EMPTY_RESULT }`) is a shallow copy, so every caller would receive the
 * SAME `updated` and `skipped` arrays, and one `push` anywhere would corrupt
 * every future call. Nothing mutates them today; this makes it impossible.
 */
function emptyResult(overrides?: Partial<BktApplyResult>): BktApplyResult {
  return {
    updated: [],
    skipped: [],
    masteryWriteError: null,
    logWriteError: null,
    ...overrides,
  };
}

/**
 * Apply a batch of observations for one student, then persist.
 *
 * NEVER REJECTS FOR A DATA REASON. Database failures come back in
 * `masteryWriteError` / `logWriteError` so the caller can log them without
 * losing the student's score. It can still throw on a programming error, which
 * is why both call sites keep their own try/catch.
 */
export async function applyBktObservations(
  studentId: string,
  observations: BktObservation[],
  opts?: { params?: BktParameters; observedAt?: Date }
): Promise<BktApplyResult> {
  if (observations.length === 0) return emptyResult();

  const params = opts?.params ?? (await loadBktParameters());
  const observedAt = opts?.observedAt ?? new Date();
  const skipped: BktApplyResult['skipped'] = [];

  // A hand-written flashcard has no concept, so there is nothing to trace. Both
  // BKT columns are NOT NULL, so an unfiltered null takes the whole batch down.
  const usable = observations.filter((o) => {
    if (o.conceptId) return true;
    skipped.push({ conceptId: null, reason: 'no_concept' });
    return false;
  }) as (BktObservation & { conceptId: string })[];

  if (usable.length === 0) return emptyResult({ skipped });

  const conceptIds = [...new Set(usable.map((o) => o.conceptId))];

  /*
   * Concepts cascade-delete when an educator re-uploads a material, but
   * `questions_payload` keeps the old UUIDs. Both `bkt_mastery.concept_id` and
   * `bkt_update_logs.concept_id` are NOT NULL REFERENCES concepts(id), so ONE
   * stale id turns a 29-row upsert into a total foreign-key failure and loses
   * mastery for every concept in the test. One query converts that into a
   * partial success.
   */
  const { data: liveConcepts, error: conceptError } = await supabaseAdmin
    .from('concepts')
    .select('id')
    .in('id', conceptIds);

  if (conceptError) {
    return emptyResult({ skipped, masteryWriteError: conceptError.message });
  }

  const live = new Set((liveConcepts ?? []).map((c) => c.id as string));
  const applicable = usable.filter((o) => {
    if (live.has(o.conceptId)) return true;
    skipped.push({ conceptId: o.conceptId, reason: 'concept_missing' });
    return false;
  });

  if (applicable.length === 0) return emptyResult({ skipped });

  const liveIds = [...new Set(applicable.map((o) => o.conceptId))];

  const { data: existing, error: priorError } = await supabaseAdmin
    .from('bkt_mastery')
    .select('concept_id, latent_mastery, opportunity_count')
    .eq('student_id', studentId)
    .in('concept_id', liveIds);

  if (priorError) {
    return emptyResult({ skipped, masteryWriteError: priorError.message });
  }

  const priors = new Map<string, { mastery: number; opportunities: number }>();
  for (const row of existing ?? []) {
    const mastery = Number(row.latent_mastery); // NUMERIC arrives as a string
    const opportunities = Number(row.opportunity_count);
    priors.set(row.concept_id as string, {
      mastery: Number.isFinite(mastery) ? clampMastery(mastery) : params.pL0,
      opportunities: Number.isFinite(opportunities) ? opportunities : 0,
    });
  }

  // Group by concept, preserving first-seen order so log ordering is deterministic.
  const byConcept = new Map<string, typeof applicable>();
  for (const obs of applicable) {
    const group = byConcept.get(obs.conceptId);
    if (group) group.push(obs);
    else byConcept.set(obs.conceptId, [obs]);
  }

  const masteryRows: Record<string, unknown>[] = [];
  const logRows: Record<string, unknown>[] = [];
  const updated: BktUpdateOutcome[] = [];

  for (const [conceptId, group] of byConcept) {
    const before = priors.get(conceptId) ?? { mastery: params.pL0, opportunities: 0 };
    let running = before.mastery;

    for (const obs of group) {
      const isTest = obs.source === 'adaptive_test';
      const guessKey = isTest
        ? GUESS_KEY_BY_FORMAT[obs.questionType]
        : GUESS_KEY_BY_RATING[obs.rating];
      const correct = isTest ? obs.isCorrect : OBSERVATION_BY_RATING[obs.rating] === 1;

      const step = bktStep({
        prior: running,
        correct,
        pGuess: params.guess[guessKey],
        pSlip: params.pS,
        pTransit: params.pT,
      });

      logRows.push({
        student_id: studentId,
        concept_id: conceptId,
        source: obs.source,
        observation: step.observation,
        p_l_prior: step.prior,
        p_guess: step.pGuess,
        p_slip: step.pSlip,
        p_transit: step.pTransit,
        p_l_evidence: step.evidence,
        p_l_posterior: step.posterior,
        flashcard_id: isTest ? null : obs.flashcardId,
        practice_test_id: isTest ? obs.practiceTestId : null,
        question_type: isTest ? obs.questionType : null,
        rating: isTest ? null : obs.rating,
        /*
         * Staggered a millisecond apart in chain order.
         *
         * Postgres now() is TRANSACTION-start time, so every row of a batch
         * insert gets a byte-identical created_at and `ORDER BY created_at` on
         * idx_bkt_update_logs_student_concept returns the chain scrambled —
         * which would make the ICR audit query unreadable. Today one concept
         * never repeats inside one batch (allocateConcepts gives one question
         * per concept, flashcards are N=1), so the ties are all between
         * independent chains and this is insurance rather than a fix. Keep it:
         * the invariant is upstream and could change.
         */
        created_at: new Date(observedAt.getTime() + logRows.length).toISOString(),
      });

      running = step.posterior;
    }

    masteryRows.push({
      student_id: studentId,
      concept_id: conceptId,
      latent_mastery: running,
      // Reporting metadata only — paper p. 71 uses "learning opportunity" as the
      // time index t and never puts a count in any equation.
      opportunity_count: before.opportunities + group.length,
      last_updated: observedAt.toISOString(), // no trigger on this column
    });

    updated.push({
      conceptId,
      priorBefore: before.mastery,
      mastery: running,
      observations: group.length,
      opportunityCount: before.opportunities + group.length,
    });
  }

  /*
   * Mastery FIRST, then the audit trail.
   *
   * `bkt_mastery` is the state the rest of the system reads — the difficulty
   * tier, EQ(4), both analytics views. `bkt_update_logs` has no runtime reader.
   * If only one write can survive it must be the state.
   *
   * The failure modes are also asymmetric. Mastery written and log missing is a
   * documented hole, and the observation still exists in practice_telemetry /
   * spaced_repetition_logs so the row is reconstructable. Log written and
   * mastery missing means the NEXT observation chains from a stale prior, and
   * that next row's p_l_prior contradicts this row's p_l_posterior — a
   * permanently corrupt audit trail, which for a paper about implementation
   * correctness is much the worse outcome. So a failed upsert writes no logs.
   */
  const { error: masteryError } = await supabaseAdmin
    .from('bkt_mastery')
    .upsert(masteryRows, { onConflict: 'student_id,concept_id' });

  if (masteryError) {
    return { updated: [], skipped, masteryWriteError: masteryError.message, logWriteError: null };
  }

  const { error: logError } = await supabaseAdmin.from('bkt_update_logs').insert(logRows);

  return {
    updated,
    skipped,
    masteryWriteError: null,
    logWriteError: logError ? logError.message : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Adapters — one per permitted writer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Adaptive Test Mode. Call from `PUT /api/practice/:id/complete`.
 *
 * Feed this the SAME array that was inserted into `practice_telemetry`, never a
 * re-derivation from `questions_payload` — mapping from one source makes it
 * impossible for the telemetry rows and the BKT observations to disagree about
 * what happened, and `count(bkt_update_logs) == count(practice_telemetry)` stays
 * a valid reconciliation.
 */
export async function applyTestCompletion(args: {
  studentId: string;
  practiceTestId: string;
  items: {
    conceptId: string | null;
    questionType: QuestionFormat;
    isCorrect: boolean;
    questionIndex: number;
  }[];
}): Promise<BktApplyResult> {
  // Sorted explicitly rather than trusting the caller's array order. It is in
  // index order today; one line decouples the chain from that forever.
  const ordered = [...args.items].sort((a, b) => a.questionIndex - b.questionIndex);

  return applyBktObservations(
    args.studentId,
    ordered.map((item) => ({
      source: 'adaptive_test' as const,
      conceptId: item.conceptId,
      questionType: item.questionType,
      isCorrect: item.isCorrect,
      practiceTestId: args.practiceTestId,
      questionIndex: item.questionIndex,
    }))
  );
}

/**
 * Adaptive Flashcards. Call from the `counted: true` branch of
 * `POST /api/flashcards/rate` — and ONLY from there.
 *
 * The due-check upstream is what keeps this honest: a card re-drilled thirty
 * seconds after being rated is not due, so it produces no observation. Without
 * that, a student rating Hard then immediately Easy after reading the answer
 * would drive mastery up fastest on exactly the concepts they are weakest at,
 * and BKT's assumption that each observation independently tests latent
 * knowledge would be false.
 */
export async function applyFlashcardRating(args: {
  studentId: string;
  conceptId: string | null;
  flashcardId: string;
  rating: EaseRating;
}): Promise<BktApplyResult> {
  return applyBktObservations(args.studentId, [
    {
      source: 'flashcard',
      conceptId: args.conceptId,
      rating: args.rating,
      flashcardId: args.flashcardId,
    },
  ]);
}

/** One line per non-empty problem, for a route to log. Empty when all is well. */
export function bktProblems(result: BktApplyResult): string[] {
  const problems: string[] = [];
  if (result.masteryWriteError) problems.push(`mastery upsert failed: ${result.masteryWriteError}`);
  if (result.logWriteError) problems.push(`audit log insert failed: ${result.logWriteError}`);
  if (result.skipped.length > 0) {
    const counts = new Map<string, number>();
    for (const s of result.skipped) counts.set(s.reason, (counts.get(s.reason) ?? 0) + 1);
    problems.push(
      `skipped ${result.skipped.length} observation(s): ` +
        [...counts].map(([reason, n]) => `${n} ${reason}`).join(', ')
    );
  }
  return problems;
}
