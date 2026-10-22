import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { CreateGameSessionSchema } from '../types/api';
import { logActivity } from '../lib/activity';

const router = Router();
router.use(authenticate, requireRole('student'));

/** GET /api/gamification/profile: the student's streak. Never inserts; a missing row reads as zeros. */
router.get('/profile', async (req: Request, res: Response): Promise<void> => {
  const studentId = req.user!.id;

  const { data: profile, error } = await supabaseAdmin
    .from('gamification_profiles')
    .select('student_id, day_streak, longest_streak, total_study_hours, last_active_on')
    .eq('student_id', studentId)
    .maybeSingle();

  if (error) {
    res.status(500).json({ error: 'Failed to fetch profile', message: error.message });
    return;
  }

  res.json({
    data: profile ?? {
      student_id: studentId,
      day_streak: 0,
      longest_streak: 0,
      total_study_hours: 0,
      last_active_on: null,
    },
  });
});

/**
 * POST /api/gamification/session. Only the outcome comes from the client; space, material, game type
 * and mastery snapshot come from the owner-checked game_content row. Fields are listed explicitly.
 * Streaks come from logActivity(), not this insert.
 */
router.post('/session', async (req: Request, res: Response): Promise<void> => {
  const parsed = CreateGameSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    return;
  }

  const { content_id, accuracy, time_spent_ms, detail } = parsed.data;

  // 404, never 403.
  const { data: content } = await supabaseAdmin
    .from('game_content')
    .select('id, space_id, material_ids, game_type, mastery_snapshot')
    .eq('id', content_id)
    .eq('student_id', req.user!.id)
    .maybeSingle();

  if (!content) {
    res.status(404).json({ error: 'Game content not found' });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from('game_sessions')
    .insert({
      student_id: req.user!.id,
      content_id: content.id,
      space_id: content.space_id,
      // Nullable: a game may span several materials.
      material_id: (content.material_ids as string[] | null)?.[0] ?? null,
      game_type: content.game_type,
      mastery_snapshot: content.mastery_snapshot,
      accuracy,
      time_spent_ms,
      detail,
    })
    .select()
    .single();

  if (error) {
    res.status(500).json({ error: 'Failed to log game session', message: error.message });
    return;
  }

  // Streak + badges, using the owner-checked content row.
  await logActivity({
    studentId: req.user!.id,
    type: 'game',
    spaceId: content.space_id,
    materialId: (content.material_ids as string[] | null)?.[0] ?? null,
    durationMs: time_spent_ms,
    outcome: { accuracy },
  });

  res.status(201).json({ data, message: 'Game session logged' });
});

/** GET /api/gamification/sessions: recent sessions with material titles. */
router.get('/sessions', async (req: Request, res: Response): Promise<void> => {
  const { data, error } = await supabaseAdmin
    .from('game_sessions')
    .select('id, game_type, accuracy, time_spent_ms, detail, completed_at, materials(title)')
    .eq('student_id', req.user!.id)
    .order('completed_at', { ascending: false })
    .limit(15);

  if (error) {
    res.status(500).json({ error: 'Failed to fetch game sessions', message: error.message });
    return;
  }

  res.json({ data });
});

/** GET /api/gamification/badges: earned badges, newest first. The client falls back for unknown names. */
router.get('/badges', async (req: Request, res: Response): Promise<void> => {
  const { data, error } = await supabaseAdmin
    .from('user_badges')
    .select('badge_name, awarded_at')
    .eq('student_id', req.user!.id)
    .order('awarded_at', { ascending: false });

  if (error) {
    res.status(500).json({ error: 'Failed to fetch badges', message: error.message });
    return;
  }

  // Same `{ name, awarded_at }` shape as the dashboard.
  res.json({
    data: (data ?? []).map((b) => ({
      name: b.badge_name as string,
      awarded_at: b.awarded_at as string,
    })),
  });
});

export default router;
