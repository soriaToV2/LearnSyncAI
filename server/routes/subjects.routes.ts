import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';

/**
 * The subject catalogue — `public.subjects`, served to the two portals that
 * render a subject.
 *
 * ══ WHY THIS EXISTS ══
 * Both subject pickers used to map over `SUBJECTS`, a hand-kept array in
 * `src/data/mockEducator.ts` that copied the nine rows the schema seeds. The
 * copy drifted the first time anyone edited the table: Christian Living was
 * deleted in Supabase and both dropdowns went on offering it, because nothing on
 * the client had ever read the table. The file's own comment had predicted it —
 * "the server re-validates the code on upload, so drift is a readable 400 rather
 * than a crash" — which describes the symptom rather than preventing it.
 *
 * The writes were never wrong. `POST /api/materials` and `POST /api/spaces` both
 * check the code against this same table and answer a readable 400
 * (`materials.routes.ts`, `studyspaces.routes.ts`). They remain the guarantee;
 * this route only stops the picker from offering something the guarantee will
 * refuse.
 *
 * ══ IT ACCEPTS NOTHING ══
 * No body, no query string, no path parameter — so it has no IDOR surface and
 * therefore no Zod schema, the same bar `GET /api/dashboard` and
 * `GET /api/educator/overview` meet. If a parameter is ever added,
 * `safeParse(req.query)` it.
 *
 * ══ READ-ONLY, PERMANENTLY ══
 * The catalogue is edited from the Supabase dashboard, which is what the
 * `"Admins manage subjects"` RLS policy is for. There is deliberately no admin
 * screen for it: CLAUDE.md lists one as absent, and `educator_assignments` is
 * the precedent for what building one costs.
 *
 * ⚠️ `requireRole`, NOT BARE `authenticate`. `requireRole` is the only
 * middleware that reads `profiles`, so it is the only one that applies the
 * first-login activation gate — a route mounting `authenticate` alone is exactly
 * the hole that had to be closed in four places. Admin is omitted because the
 * admin portal renders no subject anywhere; adding it is one word if that
 * changes.
 */

const router = Router();
router.use(authenticate, requireRole('student', 'educator'));

/** A row of `public.subjects`. `src/context/SubjectsContext.tsx` mirrors this shape. */
export interface SubjectRow {
  code: string;
  name: string;
  sort_order: number;
}

/**
 * GET /api/subjects — the whole catalogue, in display order.
 *
 * Ordered here rather than on the client so every consumer gets the school's
 * intended sequence without repeating the sort. `sort_order` is carried in the
 * payload anyway, so a caller that needs to re-sort can.
 */
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
