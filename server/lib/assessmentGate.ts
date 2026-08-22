import type { Request, Response, RequestHandler, NextFunction } from 'express';
import { supabaseAdmin } from './supabase';
import type { AssessmentPhaseValue } from '../types/api';

/**
 * The pre/post-test lock — TEMPORARY research instrument (migration 0024).
 *
 * Removed after the school study; every call site carries a `PRE/POST GATE`
 * marker comment so removal is a grep.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULE, IN ONE LINE: a material is locked for a student when its assessment's
 * LATEST RELEASED PHASE has no completed attempt by that student.
 *
 *   gatePhase = post_released_at ? 'post' : pre_released_at ? 'pre' : null
 *   locked    = gatePhase !== null && no completed attempt for (student, gatePhase)
 *
 * ⚠️ LATEST, NOT "ANY RELEASED PHASE WITH NO ATTEMPT". The obvious reading locks
 * a student out permanently: an educator who releases the post-test while some
 * students still owe the pre-test would leave those students gated on `pre` — a
 * phase the Post-Test tab no longer offers — with no route to either test. The
 * schema backs this up from the other side (`material_assessments_release_order`
 * forbids releasing `post` first), and un-releasing is the escape hatch.
 *
 * WHY IT EXISTS: the pre-test is a BASELINE. A student who reads the lesson, then
 * sits the "pre"-test, has an inflated baseline and a shrunken measured gain, and
 * paper RQ4 (p. 55) is exactly that gain. So the lock covers reading the PDF and
 * the chatbot, not only the four study tools.
 *
 * ⚠️ THE LOCK IS FORWARD-LOOKING AND DOES NOT REVOKE PAST WORK. An adaptive test
 * already in progress can be finished, an already-generated game replays, and
 * Free Recall and chat history still quote the material. That is a decision, not
 * a gap: before the PRE-test the student has never been able to open the material,
 * so no such work can exist; by the POST-test they have studied it for weeks, so
 * there is nothing left to protect. Hardening those paths would buy nothing and
 * would mean touching four verified read routes.
 *
 * ⚠️ ORDER: this must run AFTER `rejectInaccessibleMaterials()` /
 * `requireMaterialAccess()`, never before. That ordering is what makes archiving
 * and re-grading self-healing — `accessibleMaterialIds()` has already dropped the
 * material and answered, so this function never has to know about `is_archived`
 * or `grade_level`.
 */

interface AssessmentGateRow {
  id: string;
  material_id: string;
  pre_released_at: string | null;
  post_released_at: string | null;
}

/** The phase a released assessment currently gates on, or null when nothing is released. */
export function gatePhaseOf(row: {
  pre_released_at: string | null;
  post_released_at: string | null;
}): AssessmentPhaseValue | null {
  if (row.post_released_at) return 'post';
  if (row.pre_released_at) return 'pre';
  return null;
}

export interface MaterialLock {
  material_id: string;
  assessment_id: string;
  phase: AssessmentPhaseValue;
}

/**
 * Which of these materials are locked for this student, and on which phase.
 *
 * Two queries whatever the id count, and an empty input costs none. Returns a Map
 * rather than a boolean so a caller can say WHICH material is blocking and on
 * which phase — the student UI needs both to write "Take the pre-test for X".
 *
 * Fails OPEN on a database error. That is the opposite of `accessibleMaterialIds`,
 * which returns an empty set and denies everything, and the difference is
 * deliberate: that function guards data isolation between students, where the safe
 * failure is refusal. This one guards a research measurement, where a broken
 * lookup that silently locks fifty students out of the entire platform is far
 * worse than a handful of contaminated baselines. The error is logged loudly.
 */
export async function lockedMaterials(
  studentId: string,
  materialIds: string[]
): Promise<Map<string, MaterialLock>> {
  const locks = new Map<string, MaterialLock>();
  const ids = [...new Set(materialIds)].filter(Boolean);
  if (ids.length === 0) return locks;

  const { data: assessments, error } = await supabaseAdmin
    .from('material_assessments')
    .select('id, material_id, pre_released_at, post_released_at')
    .in('material_id', ids);

  if (error) {
    console.error('[AssessmentGate] assessment lookup failed — failing open', error.message);
    return locks;
  }

  const released = (assessments ?? [])
    .map((row) => ({ row: row as unknown as AssessmentGateRow, phase: gatePhaseOf(row as any) }))
    .filter((entry): entry is { row: AssessmentGateRow; phase: AssessmentPhaseValue } => entry.phase !== null);

  if (released.length === 0) return locks;

  // ⚠️ THE LOCK APPLIES TO STUDENTS ONLY, and the check sits HERE rather than at
  // each guard because two of the nine gated routes — GET /materials/:id/view and
  // /:id/concepts — are reachable by the uploading educator and by an admin.
  // Neither can ever hold an attempt row, so a role-blind rule would lock an
  // educator out of their own PDF the moment they released its pre-test.
  //
  // It runs AFTER the assessment lookup, not before, so the overwhelmingly common
  // case (no released test for these materials) still costs exactly one query.
  const { data: caller } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', studentId)
    .maybeSingle();
  if (caller?.role !== 'student') return locks;

  const { data: attempts, error: attemptError } = await supabaseAdmin
    .from('assessment_attempts')
    .select('assessment_id, phase')
    .eq('student_id', studentId)
    .eq('status', 'completed')
    .in(
      'assessment_id',
      released.map((entry) => entry.row.id)
    );

  if (attemptError) {
    console.error('[AssessmentGate] attempt lookup failed — failing open', attemptError.message);
    return locks;
  }

  const done = new Set((attempts ?? []).map((a) => `${a.assessment_id}:${a.phase}`));

  for (const { row, phase } of released) {
    if (done.has(`${row.id}:${phase}`)) continue;
    locks.set(row.material_id, { material_id: row.material_id, assessment_id: row.id, phase });
  }

  return locks;
}

const LOCK_MESSAGE: Record<AssessmentPhaseValue, string> = {
  pre: 'Take the pre-test for this lesson before studying it.',
  post: 'Take the post-test for this lesson to continue.',
};

/**
 * Body-array guard, mirroring `rejectInaccessibleMaterials()`'s contract exactly:
 * responds and returns false when any id is locked, and the caller returns
 * immediately.
 *
 * 403 rather than 404, for the same reason that function uses 403 — the client is
 * asking about a material its own study space already listed, so hiding the
 * material's existence would be theatre. The response names the phase so the UI
 * can route the student to the right tab instead of guessing.
 */
export async function rejectLockedMaterials(
  req: Request,
  res: Response,
  materialIds: string[]
): Promise<boolean> {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized', message: 'Not authenticated' });
    return false;
  }

  const locks = await lockedMaterials(req.user.id, materialIds);
  if (locks.size === 0) return true;

  const [lock] = locks.values();
  res.status(403).json({
    error: 'Assessment required',
    message: LOCK_MESSAGE[lock.phase],
    locked_material_id: lock.material_id,
    locked_phase: lock.phase,
  });
  return false;
}

/**
 * Path-parameter equivalent, mounted as a SECOND middleware immediately after
 * `requireMaterialAccess()` — never before it, so a material the student may not
 * read at all still answers 404 and never reveals that an assessment exists for it.
 */
export function requireUnlockedMaterial(param: string = 'id'): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized', message: 'Not authenticated' });
      return;
    }
    const ok = await rejectLockedMaterials(req, res, [req.params[param]]);
    if (ok) next();
  };
}
