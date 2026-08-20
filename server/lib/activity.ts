import { supabaseAdmin } from './supabase';
import { evaluateBadges, type AwardedBadge } from './badges';

/**
 * The single writer for `activity_logs` — DFD data store D3.
 *
 * ══ WHAT THIS UNBLOCKS ══
 * Every gamification table has existed since migration 0005 and none of them
 * has ever moved, because nothing inserted here. `trigger_update_streak` is an
 * AFTER INSERT trigger on this table; it maintains `day_streak`,
 * `longest_streak` and `total_study_hours` on `gamification_profiles` and needs
 * no help from application code. One insert is the whole streak mechanism.
 *
 * ══ IT NEVER THROWS ══
 * Deliberately unlike `applyFlashcardRating()` / `bktProblems()` next door,
 * which throw and are caught individually at each of their two call sites. That
 * idiom is right there: a BKT failure is diagnostically important and its return
 * value is consumed. This has nine call sites and no consumer that can act on a
 * failure, so nine chances to forget a `try/catch` is the larger risk. Failures
 * land in `console.error` and the student's response is untouched — a missing
 * streak day must never cost anyone a score, and there is nothing they could do
 * about it if it did.
 *
 * ══ `durationMs` IS 0 WHERE TIME IS NOT MEASURED, AND THAT IS THE HONEST VALUE ══
 * Only two activities carry a real duration: a game reports `time_spent_ms`, and
 * a test can be derived from `completed_at - created_at`. Flashcard ratings, the
 * two cognitive modes and chat measure nothing, and inventing a plausible figure
 * for them would make `total_study_hours` a number that looks real and is not —
 * the exact failure the frozen `day_streak` represented before this landed.
 * Which is why `total_study_hours` is written but NOT DISPLAYED anywhere. If a
 * screen ever wants it, the missing piece is real timing, not a widget.
 */

/** Mirrors the `activity_type` enum in schema.sql. */
export type ActivityType = 'flashcard' | 'free_recall' | 'feynman' | 'adaptive_test' | 'game' | 'chat';

export interface ActivityInput {
  studentId: string;
  type: ActivityType;
  /** Nullable in the schema (ON DELETE SET NULL). Populate it where known. */
  spaceId?: string | null;
  materialId?: string | null;
  /** Only where genuinely measured. 0 is honest; a guess is not. */
  durationMs?: number;
  /**
   * Server-computed outcome facts that performance badges read.
   *
   * NEVER CLIENT-SUPPLIED. `score` comes from `buildResult()` and `accuracy`
   * from the `game_sessions` row the server just wrote — the same principle as
   * `SubmitAnswerSchema` having no `is_correct`. A client-chosen outcome here
   * would be a client-chosen trophy.
   */
  outcome?: { score?: number; accuracy?: number };
}

/**
 * Records one study interaction and awards any badge it unlocks.
 *
 * Returns the badges that actually landed — currently unused by every caller,
 * because the badge UI reads from `GET /api/dashboard` on the next page load
 * rather than being pushed a notification. Returned anyway so that adding a
 * toast later is a client change, not a re-plumbing of five write endpoints.
 */
export async function logActivity(input: ActivityInput): Promise<AwardedBadge[]> {
  const { studentId, type, spaceId, materialId, durationMs, outcome } = input;

  try {
    const { error } = await supabaseAdmin.from('activity_logs').insert({
      student_id: studentId,
      activity_type: type,
      space_id: spaceId ?? null,
      material_id: materialId ?? null,
      // NOT NULL DEFAULT 0 with CHECK (duration_ms >= 0). A negative delta from
      // clock skew would fail the write and take the streak day with it.
      duration_ms: Math.max(0, Math.round(durationMs ?? 0)),
    });

    if (error) {
      console.error(`[Activity] insert failed for student=${studentId} type=${type}:`, error.message);
      return [];
    }

    // The streak trigger has already run — AFTER INSERT, same transaction — so
    // `gamification_profiles` is current before this line executes.
    return await evaluateBadges({ studentId, type, outcome });
  } catch (err) {
    console.error(
      `[Activity] writer threw for student=${studentId} type=${type}:`,
      err instanceof Error ? err.message : err
    );
    return [];
  }
}
