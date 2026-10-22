/**
 * Bayesian Knowledge Tracing: classical four-parameter model (paper p. 68). No pyBKT, no EM fitting.
 *
 * Per observation (paper p. 69, EQ 1/2/3):
 *   correct    P(Lt | obs=1) = P(Lt)(1-P(S)) / [ P(Lt)(1-P(S)) + (1-P(Lt))P(G) ]
 *   incorrect  P(Lt | obs=0) = P(Lt)P(S)     / [ P(Lt)P(S)     + (1-P(Lt))(1-P(G)) ]
 *   transition P(Lt+1) = P(Lt | obs) + (1 - P(Lt | obs)) P(T)
 * The post-transition value is what is persisted as `latent_mastery`.
 *
 * Only flashcards and adaptive tests may write mastery (paper p. 58).
 * Expected behaviours that look like bugs (all-wrong raises mastery; flashcards move fast;
 * clamp below 1): see BKT_IMPLEMENTATION.md §4.
 */

import { supabaseAdmin } from './supabase';
import type { EaseRating } from './reviewSchedule';
import type { QuestionFormat } from './testAllocation';

// Parameters

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
  /** P(L₀): prior for an unassessed concept. */
  pL0: number;
  /** P(T): learning rate. */
  pT: number;
  /** P(S): slip. */
  pS: number;
  /** P(G) per assessment context (paper p. 72). */
  guess: Readonly<Record<GuessKey, number>>;
}

/**
 * Seeded `bkt_parameters` values, used only as a per-key fallback when the table is unreadable.
 * Selected values within published limits, not empirically derived (paper pp. 70-76).
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
 * Reads `bkt_parameters`, cached for the process lifetime (parameters are constant, paper p. 75).
 * Never throws: a bad or missing key falls back per key and logs an error.
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

    // Not `Number(v) || fallback`: 0 is a valid probability.
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

    // testDifficulty.P_L0 is a compile-time constant; keep the two in step.
    if (params.pL0 !== 0.1) {
      console.error(
        `[BKT] bkt_parameters.p_l0 is ${params.pL0} but testDifficulty.P_L0 is 0.1. ` +
          `Unassessed concepts and assessed ones are now being scored against different priors.`
      );
    }

    // Beck & Chang: P(G) + P(S) < 1 (paper p. 74).
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

// Pure core

/** Kept strictly inside (0, 1): at exactly 1.0 an incorrect answer can never lower mastery again. */
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

export interface BktStep {
  /** P(Lt), after clamping. */
  prior: number;
  observation: 0 | 1;
  pGuess: number;
  pSlip: number;
  pTransit: number;
  /** EQ(1)/EQ(2). */
  evidence: number;
  /** EQ(3); the persisted value. */
  posterior: number;
}

/** One two-phase update. Pure, so the ICR harness can verify it without a database. */
export function bktStep(input: BktStepInput): BktStep {
  const prior = clampMastery(input.prior);
  const { correct, pGuess, pSlip, pTransit } = input;

  const numerator = correct ? prior * (1 - pSlip) : prior * pSlip;
  const denominator = correct
    ? prior * (1 - pSlip) + (1 - prior) * pGuess
    : prior * pSlip + (1 - prior) * (1 - pGuess);

  // Zero denominator: the observation carries no information, keep the prior. `!(x > 0)` also catches NaN.
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

// Context → P(G). Exhaustive Records so a new format or rating fails the type check.

/** Paper pp. 73-75. Matching is per matched item. */
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

/** Paper pp. 78-79: Easy/Medium are correct observations, Hard is incorrect. */
export const OBSERVATION_BY_RATING: Readonly<Record<EaseRating, 0 | 1>> = Object.freeze({
  easy: 1,
  medium: 1,
  hard: 0,
});

// Observations and the orchestrator

/** One learning opportunity. Flashcard correctness is derived from the rating, never passed in. */
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
  /** P(L) before this batch; P(L₀) when the concept had no row. */
  priorBefore: number;
  /** P(L) after the batch, as persisted. */
  mastery: number;
  observations: number;
  opportunityCount: number;
  /** False when this batch was the first evidence, so `priorBefore` must not be shown as a score. */
  assessedBefore: boolean;
}

export interface BktApplyResult {
  updated: BktUpdateOutcome[];
  skipped: { conceptId: string | null; reason: 'no_concept' | 'concept_missing' }[];
  /** Set when `bkt_mastery` could not be written. Nothing was persisted. */
  masteryWriteError: string | null;
  /** Set when the audit rows failed. Mastery is persisted. */
  logWriteError: string | null;
}

/** A function, not a shared constant, so callers never share the same arrays. */
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
 * Applies a batch of observations for one student, then persists.
 * DB failures are returned, not thrown; it can still throw on a programming error.
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

  // Both BKT concept_id columns are NOT NULL.
  const usable = observations.filter((o) => {
    if (o.conceptId) return true;
    skipped.push({ conceptId: null, reason: 'no_concept' });
    return false;
  }) as (BktObservation & { conceptId: string })[];

  if (usable.length === 0) return emptyResult({ skipped });

  const conceptIds = [...new Set(usable.map((o) => o.conceptId))];

  // Re-uploads cascade-delete concepts; drop stale ids so one FK failure can't sink the whole batch.
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

  // Group by concept in first-seen order so log ordering is deterministic.
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
        // Staggered 1ms in chain order: now() is transaction-start time, so a batch would tie.
        created_at: new Date(observedAt.getTime() + logRows.length).toISOString(),
      });

      running = step.posterior;
    }

    masteryRows.push({
      student_id: studentId,
      concept_id: conceptId,
      latent_mastery: running,
      // Reporting only; never used in the arithmetic.
      opportunity_count: before.opportunities + group.length,
      last_updated: observedAt.toISOString(), // no trigger on this column
    });

    updated.push({
      conceptId,
      priorBefore: before.mastery,
      mastery: running,
      observations: group.length,
      opportunityCount: before.opportunities + group.length,
      assessedBefore: priors.has(conceptId),
    });
  }

  // Mastery first, then logs. A failed upsert writes no logs, or the next row's prior would contradict this one.
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

// Adapters, one per permitted writer

/**
 * Adaptive Test Mode, from `PUT /api/practice/:id/complete`.
 * Pass the same array inserted into `practice_telemetry`, never a re-derivation.
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

/** Adaptive Flashcards. Call only from the `counted: true` branch of `POST /api/flashcards/rate`. */
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

/** One line per problem, for a route to log. Empty when all is well. */
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
