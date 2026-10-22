import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';

/**
 * The `public.subjects` catalogue, read-only, for the student and educator pickers (so a deleted
 * subject is never offered). Accepts no input. Edited from the Supabase dashboard. The upload and
 * space routes still validate codes themselves.
 */

const router = Router();
router.use(authenticate, requireRole('student', 'educator'));

/** A row of `public.subjects`. `src/context/SubjectsContext.tsx` mirrors this shape. */
export interface SubjectRow {
  code: string;
  name: string;
  sort_order: number;
}

/** GET /api/subjects: the catalogue in display order. */
router.get('/', async (_req: Request, res: Response): Promise<void> => {
  const { data, error } = await supabaseAdmin
    .from('subjects')
    .select('code, name, sort_order')
    .order('sort_order');

  if (error) {
    console.error('[subjects] could not read the catalogue', error.message);
    res.status(500).json({
      error: 'Database error',
      message: 'Could not load the subject list.',
    });
    return;
  }

  res.json({ data: (data ?? []) as SubjectRow[] });
});

export default router;
