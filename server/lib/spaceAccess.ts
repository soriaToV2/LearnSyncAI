/**
 * Who owns which study space, and what a space actually shows.
 *
 * Companion to `materialAccess.ts`. That file answers "may this caller read this
 * MATERIAL?" from the grade-level rules; this one answers "is this SPACE the
 * caller's, and which materials does it currently hold?". Both exist for the same
 * reason, spelled out in migration 0008: the service role key bypasses Row-Level
 * Security by design, so the API layer must enforce ownership itself.
 *
 * THIS WAS THREE PRIVATE COPIES. `studyspaces.routes.ts` and `practice.routes.ts`
 * each carried their own `loadOwnedSpace`/`requireOwnedSpace`, differing only in
 * whether they selected `title` and whether they sent the 404 themselves, and
 * `cognitive.routes.ts` carried a third that returned the student id. Games would
 * have been the fourth. The active/role/grade checks below are the part that must
 * not drift — a disabled account or an educator holding a student's space id must
 * come back empty from every one of them.
 *
 * 404, NEVER 403. A 403 confirms the id names a real space, and space ids are
 * visible in the address bar (`/student/space/:spaceId`).
 */

import { Request, Response } from 'express';
import { supabaseAdmin } from './supabase';
import { publishedMaterialIds } from './materialAccess';

export interface SpaceOwner {
  id: string;
  title: string;
  subject: string;
  /** The OWNER's grade level, not the caller's — they are the same by construction. */
  gradeLevel: number;
}

/**
 * The space, but only for its owner and only for an active student with a grade.
 *
 * Returns null on every failure without distinguishing them; the caller sends the
 * 404. Use `requireOwnedSpace()` unless you genuinely need to handle the miss.
 */
export async function loadOwnedSpace(spaceId: string, userId: string): Promise<SpaceOwner | null> {
  const [{ data: space }, { data: profile }] = await Promise.all([
    supabaseAdmin
      .from('study_spaces')
      .select('id, title, subject, student_id')
      .eq('id', spaceId)
      .maybeSingle(),
    supabaseAdmin
      .from('profiles')
      .select('grade_level, status, role')
      .eq('id', userId)
      .maybeSingle(),
  ]);

  if (!space || space.student_id !== userId) return null;
  if (!profile || profile.status !== 'active' || profile.role !== 'student') return null;
  if (profile.grade_level === null || profile.grade_level === undefined) return null;

  return {
    id: space.id as string,
    title: space.title as string,
    subject: space.subject as string,
    gradeLevel: profile.grade_level as number,
  };
}

/**
 * `loadOwnedSpace()` that answers the request on failure.
 *
 * Returns null after `res` has already been written, so every caller is
 * `const space = await requireOwnedSpace(...); if (!space) return;`.
 */
export async function requireOwnedSpace(
  spaceId: string,
  req: Request,
  res: Response
): Promise<SpaceOwner | null> {
  const space = await loadOwnedSpace(spaceId, req.user!.id);
  if (!space) {
    res.status(404).json({ error: 'Study space not found' });
    return null;
  }
  return space;
}

/**
 * The materials a space actually shows: linked to it AND still published to this
 * subject and grade.
 *
 * The intersection is what makes an educator's archive action drop a material
 * from every student's space instantly while the `study_space_materials` link row
 * survives — un-archive and it returns on its own.
 *
 * Not redundant with `rejectInaccessibleMaterials()`. That proves the student may
 * READ the material; this proves THIS SPACE holds it. A route that generates
 * something attributed to a space needs both.
 */
export async function spaceMaterialIds(space: SpaceOwner): Promise<string[]> {
  const published = await publishedMaterialIds(space.subject, space.gradeLevel);
  const { data: linked } = await supabaseAdmin
    .from('study_space_materials')
    .select('material_id')
    .eq('space_id', space.id);

  const publishedSet = new Set(published);
  return (linked ?? [])
    .map((row) => row.material_id as string)
    .filter((id) => publishedSet.has(id));
}
