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
    // Row not found — create a default profile (day_streak defaults to 0).
    const { data: created, error: createError } = await supabaseAdmin
      .from('gamification_profiles')
      .insert({ student_id: studentId })
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
 * Body: { content_id, accuracy?, time_spent_ms?, detail? }
 *
 * ONLY THE OUTCOME COMES FROM THE CLIENT. `space_id`, `material_id`, `game_type`
 * and `mastery_snapshot` are read from the `game_content` row `content_id` names,
 * after confirming the caller owns it — the same principle as `SubmitAnswerSchema`
 * having no `is_correct`. `mastery_snapshot` in particular is the evidence the
 * paper's Difficulty Alignment check (p. 98) reads, so a client-supplied value
 * would be a client-chosen finding.
 *
 * The insert lists its fields explicitly. It used to be `{ ...parsed.data }`,
 * which silently binds the request shape to the table's columns — add a field to
 * the schema and the next insert fails with PGRST204, invisibly, because the
 * client swallows every error from this endpoint.
 *
 * There is no streak or badge write here, and no XP. The `trigger_update_streak`
 * trigger fires on `activity_logs`, not on this table, and nothing in the server
 * writes an activity log yet — so `day_streak` is still 0 for everyone. The
 * previous version of this comment claimed otherwise.
 */
router.post('/session', async (req: Request, res: Response): Promise<void> => {
  const parsed = CreateGameSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    return;
  }

  const { content_id, accuracy, time_spent_ms, detail } = parsed.data;

  // 404 rather than 403, matching GET /api/games/content/:id, so a student cannot
  // probe which content ids exist.
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
      // Nullable by design — a game may be generated from several materials, and
      // this column exists only for the `materials(title)` join in GET /sessions.
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

  res.status(201).json({ data, message: 'Game session logged' });
});

/**
 * GET /api/gamification/sessions
 * Returns the authenticated student's most recent game sessions (newest first),
 * with the source material's title embedded for display.
 */
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
