/**
 * Study space ownership and contents; the single home for these checks.
 * The service role bypasses RLS, so ownership is enforced here. Misses answer 404, never 403.
 */

import { Request, Response } from 'express';
import { supabaseAdmin } from './supabase';
import { publishedMaterialIds } from './materialAccess';

export interface SpaceOwner {
  id: string;
  title: string;
  subject: string;
  /** The owner's grade level. */
  gradeLevel: number;
}

/** The space, only for its owner who must be an active student with a grade. Null on any miss. */
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

/** `loadOwnedSpace()` that sends the 404 itself; return immediately on null. */
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
 * Materials linked to the space and still published to its subject and grade. Link rows survive
 * archiving. Not redundant with rejectInaccessibleMaterials(): that proves read access, this proves the space holds it.
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
