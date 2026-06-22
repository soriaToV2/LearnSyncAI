import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { CreateGameSessionSchema } from '../types/api';

const router = Router();
router.use(authenticate, requireRole('student'));

/**
 * GET /api/gamification/profile
 * Returns the authenticated student's gamification profile (XP, streak).
 * Creates a default profile row if one doesn't exist yet.
 */
router.get('/profile', async (req: Request, res: Response): Promise<void> => {
  const studentId = req.user!.id;

  let { data: profile, error } = await supabaseAdmin
    .from('gamification_profiles')
    .select('*')
    .eq('student_id', studentId)
    .single();

  if (error && error.code === 'PGRST116') {
    // Row not found — create a default profile
    const { data: created, error: createError } = await supabaseAdmin
      .from('gamification_profiles')
      .insert({ student_id: studentId, total_xp: 0, current_streak: 0 })
      .select()
      .single();

    if (createError) {
      res.status(500).json({ error: 'Failed to create gamification profile', message: createError.message });
      return;
    }
    profile = created;
  } else if (error) {
    res.status(500).json({ error: 'Failed to fetch profile', message: error.message });
    return;
  }

  res.json({ data: profile });
});

/**
 * POST /api/gamification/session
 * Logs a completed game session.
 *
 * The DB trigger `trigger_update_streak` automatically:
 *  - Adds xp_earned to gamification_profiles.total_xp
 *  - Increments or resets the streak (48-hour window)
 *  - Updates last_active_at
 *
 * Body: { material_id, game_type, xp_earned, accuracy?, time_spent_ms? }
 */
router.post('/session', async (req: Request, res: Response): Promise<void> => {
  const parsed = CreateGameSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from('game_sessions')
    .insert({ ...parsed.data, student_id: req.user!.id })
    .select()
    .single();

  if (error) {
    res.status(500).json({ error: 'Failed to log game session', message: error.message });
    return;
  }

  // Note: XP update and streak logic are handled entirely by the
  // `trigger_update_streak` PostgreSQL trigger — no additional code needed.

  res.status(201).json({ data, message: 'Game session logged. XP and streak updated.' });
});

/**
 * GET /api/gamification/badges
 * Returns all badges earned by the authenticated student.
 */
router.get('/badges', async (req: Request, res: Response): Promise<void> => {
  const { data, error } = await supabaseAdmin
    .from('user_badges')
    .select('*')
    .eq('student_id', req.user!.id)
    .order('awarded_at', { ascending: false });

  if (error) {
    res.status(500).json({ error: 'Failed to fetch badges', message: error.message });
    return;
  }

  res.json({ data });
});

export default router;
