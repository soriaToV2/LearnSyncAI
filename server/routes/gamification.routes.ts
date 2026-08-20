import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { CreateGameSessionSchema } from '../types/api';
import { logActivity } from '../lib/activity';

const router = Router();
router.use(authenticate, requireRole('student'));

/**
 * GET /api/gamification/profile
 * The authenticated student's streak. Read by the PlayMe header.
 *
 * ══ IT NO LONGER INSERTS ON A GET ══
 * It used to create the row when one was missing. `handle_new_user()` already
 * writes a `gamification_profiles` row for every student, so the branch was
 * close to dead — but a GET that writes is a trap for the next caller, and
 * `GET /api/dashboard` now reads the same table under a documented
 * read-only-permanently rule. Two readers, one of which could write, is how
 * that rule gets broken by accident.
 *
 * A missing row answers as zeros, which is both true (no activity yet) and the
 * only answer a read is allowed to give.
 *
 * `total_study_hours` is returned because the column exists and this is the
 * profile endpoint — but NO SCREEN DISPLAYS IT, deliberately. Only games and
 * adaptive tests contribute a real duration; see `server/lib/activity.ts`.
 */
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
 * STREAKS AND BADGES HANG OFF `logActivity()`, NOT OFF THIS INSERT. The
 * `trigger_update_streak` trigger fires on `activity_logs`, not on this table,
 * which is why the write below is followed by an explicit activity log rather
 * than relying on the session row. There is still no XP anywhere in the product.
 *
 * `accuracy` reaches the badge evaluator from `parsed.data`, but it is not a
 * client-chosen trophy for the same reason `mastery_snapshot` is not a
 * client-chosen finding: it is one number describing a game the server issued,
 * from content it owns, and `flawless_game` is the only rule that reads it.
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

  // Streak + badges. `space_id` and the material come from the owner-checked
  // `game_content` row, exactly as the session insert above does.
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
 * Every badge the authenticated student has earned, newest first.
 *
 * The catalogue itself lives in `server/lib/badges.ts` and is not served: a
 * client needs labels for the badges a student HOLDS, and `src/lib/badges.ts`
 * mirrors those. An unknown name must render with a fallback there rather than
 * crash, so the server can add a badge without a coordinated deploy.
 */
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

  /*
   * Serialised as `{ name, awarded_at }`, matching the `gamification.badges`
   * block on GET /api/dashboard exactly.
   *
   * This route used to `select('*')` and return the raw column name
   * `badge_name`, which meant the client held two shapes for one concept. It had
   * zero consumers at the time, so normalising cost nothing; `BadgeContext` is
   * its first caller and reads the same shape the dashboard already gives it.
   */
  res.json({
    data: (data ?? []).map((b) => ({
      name: b.badge_name as string,
      awarded_at: b.awarded_at as string,
    })),
  });
});

export default router;
