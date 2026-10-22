import { supabaseAdmin } from './supabase';
import { evaluateBadges, type AwardedBadge } from './badges';

/**
 * The only writer for `activity_logs`. One insert drives streaks via `trigger_update_streak`.
 * Never throws: a missing streak day must never cost a student their result.
 */

/** Mirrors the `activity_type` enum in schema.sql. */
export type ActivityType = 'flashcard' | 'free_recall' | 'feynman' | 'adaptive_test' | 'game' | 'chat';

export interface ActivityInput {
  studentId: string;
  type: ActivityType;
  spaceId?: string | null;
  materialId?: string | null;
  /** Only where genuinely measured; otherwise 0. */
  durationMs?: number;
  /** Server-computed outcome for performance badges. Never client-supplied. */
  outcome?: { score?: number; accuracy?: number };
}

/** Records one study interaction and returns any badges it awarded. */
export async function logActivity(input: ActivityInput): Promise<AwardedBadge[]> {
  const { studentId, type, spaceId, materialId, durationMs, outcome } = input;

  try {
    const { error } = await supabaseAdmin.from('activity_logs').insert({
      student_id: studentId,
      activity_type: type,
      space_id: spaceId ?? null,
      material_id: materialId ?? null,
      // CHECK (duration_ms >= 0); clamp so clock skew can't fail the write.
      duration_ms: Math.max(0, Math.round(durationMs ?? 0)),
    });

    if (error) {
      console.error(`[Activity] insert failed for student=${studentId} type=${type}:`, error.message);
      return [];
    }

    // The AFTER INSERT streak trigger has already run, so gamification_profiles is current.
    return await evaluateBadges({ studentId, type, outcome });
  } catch (err) {
    console.error(
      `[Activity] writer threw for student=${studentId} type=${type}:`,
      err instanceof Error ? err.message : err
    );
    return [];
  }
}
