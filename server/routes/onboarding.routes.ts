import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { MarkOnboardingSeenSchema } from '../types/api';

/**
 * Which first-run onboarding steps a student has seen (keys and copy live in src/lib/onboarding.ts).
 * Gates nothing. Never writes activity_logs, which would award streak days. No delete route
 * (scripts/reset-onboarding.ts resets for testing).
 */

const router = Router();

// requireRole, not bare authenticate, so the activation gate applies. Students only.
router.use(authenticate, requireRole('student'));

/** Rows of `onboarding_seen` for one student, as the client wants them. */
interface OnboardingState {
  seen: string[];
}

/** Every step this student has seen. Accepts no input, so no schema. */
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

/** Records a step as seen. Idempotent (ON CONFLICT DO NOTHING); returns the recorded step. */
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
