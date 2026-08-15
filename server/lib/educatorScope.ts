/**
 * Who owns which MATERIAL, and which students that material is published to.
 *
 * The educator-side companion to `spaceAccess.ts`. Same reason both exist, spelled
 * out in migration 0008: the service role key bypasses Row-Level Security by
 * design, so the API layer must enforce ownership itself. The RLS policies on
 * `materials`, `profiles` and `bkt_mastery` are all inert for a request that
 * reaches Express.
 *
 * `materialAccess.ts` answers a different question and is NOT a substitute here.
 * It asks "may this caller READ this material?", which is a grade-level rule that
 * also lets admins through and is archive-blind for educators. This file asks "is
 * this material the caller's OWN, and who is the class for it?" — the second half
 * has no equivalent anywhere else, because until now nothing on the server ever
 * needed to name a set of students.
 *
 * 404, NEVER 403. A 403 confirms the id names a real material, and material ids
 * are visible in the address bar (`/educator/materials/:materialId`). Same
 * doctrine as `requireMaterialAccess()`.
 */

import { Request, Response } from 'express';
import { supabaseAdmin } from './supabase';

export interface OwnedMaterial {
  id: string;
  title: string;
  subject: string;
  /** The grades this material is published to. Defines the class. */
  gradeLevels: number[];
  isArchived: boolean;
  parsedStatus: string;
}

/** One student in a material's class. */
export interface RosterStudent {
  id: string;
  firstName: string;
  lastName: string;
  gradeLevel: number;
}

/**
 * The material, but only for the educator who uploaded it.
 *
 * Archived materials ARE returned — an educator monitors their own archived
 * lessons, and archiving is a student-visibility action. That is the same
 * allowance `accessibleMaterialIds()` makes on its educator branch.
 *
 * Returns null on every failure without distinguishing them; the caller sends the
 * 404. Use `requireOwnedMaterial()` unless you genuinely need to handle the miss.
 */
export async function loadOwnedMaterial(
  materialId: string,
  educatorId: string
): Promise<OwnedMaterial | null> {
  const { data } = await supabaseAdmin
    .from('materials')
    .select('id, educator_id, title, subject, grade_levels, is_archived, parsed_status')
    .eq('id', materialId)
    .maybeSingle();

  if (!data || data.educator_id !== educatorId) return null;

  return {
    id: data.id as string,
    title: data.title as string,
    subject: data.subject as string,
    gradeLevels: (data.grade_levels as number[]) ?? [],
    isArchived: Boolean(data.is_archived),
    parsedStatus: (data.parsed_status as string) ?? 'pending',
  };
}

/**
 * `loadOwnedMaterial()` that answers the request on failure.
 *
 * Every caller is
 * `const material = await requireOwnedMaterial(id, req, res); if (!material) return;`.
 */
export async function requireOwnedMaterial(
  materialId: string,
  req: Request,
  res: Response
): Promise<OwnedMaterial | null> {
  const material = await loadOwnedMaterial(materialId, req.user!.id);
  if (!material) {
    res.status(404).json({ error: 'Material not found' });
    return null;
  }
  return material;
}

/**
 * The class for a material: every ACTIVE student in a grade it is published to.
 *
 * This is the same population `v_grade_level_mastery` defines, minus that view's
 * one real defect — it has no `p.status = 'active'` filter, so a disabled account
 * still appears in it. An educator must not see performance rows for an account an
 * admin has switched off.
 *
 * Note the filter direction: `grade_levels` is a SMALLINT[] on the material and
 * `grade_level` a scalar on the profile, so this is `.in('grade_level', …)` — the
 * scalar column against the array literal — never `.contains()`.
 *
 * Sorted by name so the "not started" tail, which has no mastery to rank on, has a
 * stable order without the caller sorting again.
 */
export async function rosterFor(material: OwnedMaterial): Promise<RosterStudent[]> {
  if (material.gradeLevels.length === 0) return [];

  const { data } = await supabaseAdmin
    .from('profiles')
    .select('id, first_name, last_name, grade_level')
    .eq('role', 'student')
    .eq('status', 'active')
    .in('grade_level', material.gradeLevels)
    .order('last_name')
    .order('first_name');

  return (data ?? []).map((row) => ({
    id: row.id as string,
    firstName: (row.first_name as string) ?? '',
    lastName: (row.last_name as string) ?? '',
    gradeLevel: row.grade_level as number,
  }));
}

/**
 * One student, but only if they are genuinely in this material's class.
 *
 * The IDOR defence for the only educator route that names another user in its
 * path. Role, status and grade are ALL re-derived here rather than trusted from
 * the request — an educator holding a student id from a grade they do not publish
 * to must come back null, and so must a disabled account.
 */
export async function rosterStudent(
  material: OwnedMaterial,
  studentId: string
): Promise<RosterStudent | null> {
  if (material.gradeLevels.length === 0) return null;

  const { data } = await supabaseAdmin
    .from('profiles')
    .select('id, first_name, last_name, grade_level, role, status')
    .eq('id', studentId)
    .maybeSingle();

  if (!data) return null;
  if (data.role !== 'student' || data.status !== 'active') return null;
  if (!material.gradeLevels.includes(data.grade_level as number)) return null;

  return {
    id: data.id as string,
    firstName: (data.first_name as string) ?? '',
    lastName: (data.last_name as string) ?? '',
    gradeLevel: data.grade_level as number,
  };
}
