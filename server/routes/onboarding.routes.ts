import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { MarkOnboardingSeenSchema } from '../types/api';

/**
 * Student first-run onboarding — which introductory steps this account has
 * already been shown.
 *
 * ══ WHAT IT IS FOR ══
 * Accounts are issued by an administrator, never self-registered, so every
 * student arrives having never seen the application. Three surfaces read this:
 * the guided tour on first arrival at the dashboard, the short panel at the top
 * of each study tool the first time it is opened, and the Help page's replay
 * button. `src/lib/onboarding.ts` is the catalogue of keys and every word of the
 * copy; this route only records which of them a student has met.
 *
 * ══ ⚠️ IT GATES NOTHING, AND THAT IS THE POINT ══
 * `profiles.must_change_password` is the other per-account flag in this codebase
 * and it is an ACCESS GATE — which is why it had to be read in `requireRole`,
 * and why landing it forced an audit of every route mounting `authenticate`
 * without a role check. Nothing here is read by any middleware and no route
 * refuses on it. A failed read shows a student a tour step twice; a failed write
 * shows it again next session. Neither can cost anyone their access or a score,
 * which is why both client call sites swallow their errors.
 *
 * ══ ⚠️ NOTHING HERE TOUCHES `activity_logs` ══
 * Every insert into that table fires `trigger_update_streak`, so recording a
 * tour there would award a study-streak day for reading it, and `badges.ts`'s
 * `ANY` list would count it toward streak_3/5/7. `activity_type` deliberately
 * gains no value for onboarding, and there is no badge for finishing the tour —
 * a badge can only be awarded from `evaluateBadges`, which only `logActivity`
 * calls, so one would require exactly the enum value this avoids.
 *
 * ══ NO DELETE ROUTE ══
 * Resetting is a developer action for re-testing, so it is
 * `scripts/reset-onboarding.ts`, in the same spirit as
 * `scripts/set-test-mastery.ts`. An endpoint a student could reach would let
 * them clear a record whose only purpose is to stop pestering them.
 */

const router = Router();

/*
 * ⚠️ `requireRole`, NOT BARE `authenticate`. It is the only middleware that
 * reads `profiles`, so it is the only one that applies the first-login
 * activation gate — a route mounting `authenticate` alone is the hole that had
 * to be closed in four places when that gate landed.
 *
 * Student only. The admin and educator portals have no onboarding, and
 * `onboarding_seen.student_id` references `profiles(id)` with the student
 * semantics the rest of the gamification tables use.
 */
router.use(authenticate, requireRole('student'));

/** Rows of `onboarding_seen` for one student, as the client wants them. */
interface OnboardingState {
  seen: string[];
}

/**
 * Read every step this student has been shown.
 *
 * ══ IT ACCEPTS NOTHING ══
 * No body, no query string, no path parameter — so it has zero IDOR surface and
 * therefore no Zod schema, the same bar `GET /api/dashboard`,
 * `GET /api/educator/overview` and `GET /api/subjects` are held to. The student
 * is `req.user!.id` and there is nothing to point it at anybody else.
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const { data, error } = await supabaseAdmin
    .from('onboarding_seen')
    .select('step_key')
    .eq('student_id', req.user!.id);

  if (error) {
    console.error('[onboarding] could not read progress', error.message);
    res.status(500).json({
      error: 'Database error',
      message: 'Could not load your onboarding progress.',
    });
    return;
  }

  const state: OnboardingState = {
    seen: (data ?? []).map((row) => row.step_key as string),
  };
  res.json({ data: state });
});

/**
 * Record that a step has been shown. Idempotent.
 *
 * ON CONFLICT DO NOTHING via `ignoreDuplicates`, exactly as `badges.ts` awards a
 * badge — and the conflict is reachable in practice rather than in theory: two
 * tabs open on the same account, or a double-tapped "Got it" on a phone, both
 * arrive having read the same empty state. The composite primary key is the
 * arbiter, so no read-then-write lock is needed.
 *
 * It answers with the step it recorded rather than re-reading the whole set: the
 * client already holds that set and updates it locally, so a second query here
 * would buy nothing.
 */
router.post('/seen', async (req: Request, res: Response): Promise<void> => {
  const parsed = MarkOnboardingSeenSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation error',
      details: parsed.error.flatten(),
    });
    return;
  }

  const { step_key } = parsed.data;

  const { error } = await supabaseAdmin
    .from('onboarding_seen')
    .upsert(
      { student_id: req.user!.id, step_key },
      { onConflict: 'student_id,step_key', ignoreDuplicates: true }
    );

  if (error) {
    console.error(`[onboarding] could not record ${step_key}`, error.message);
    res.status(500).json({
      error: 'Database error',
      message: 'Could not save your onboarding progress.',
    });
    return;
  }

  res.json({ data: { step_key } });
});

export default router;
