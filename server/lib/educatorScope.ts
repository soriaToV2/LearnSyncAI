/**
 * Educator ownership of materials, and each material's class roster.
 * The service role bypasses RLS, so ownership is enforced here. Not a substitute for
 * materialAccess.ts, which answers "may this caller read it?". Misses answer 404, never 403.
 */

import { Request, Response } from 'express';
import { supabaseAdmin } from './supabase';

export interface OwnedMaterial {
  id: string;
  title: string;
  subject: string;
  /** Grades the material is published to; defines the class. */
  gradeLevels: number[];
  isArchived: boolean;
  parsedStatus: string;
}

export interface RosterStudent {
  id: string;
  firstName: string;
  lastName: string;
  gradeLevel: number;
}

/** The material, only for its uploader; archived materials included. Null on any miss. */
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

/** `loadOwnedMaterial()` that sends the 404 itself; return immediately on null. */
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
 * Every active student in these grades: the one definition of "the class", sorted by name.
 * Takes grades rather than a material so callers fetch a union once; never call it in a loop.
 */
export async function rosterForGrades(grades: number[]): Promise<RosterStudent[]> {
  const distinct = [...new Set(grades)];
  if (distinct.length === 0) return [];

  const { data } = await supabaseAdmin
    .from('profiles')
    .select('id, first_name, last_name, grade_level')
    .eq('role', 'student')
    .eq('status', 'active')
    .in('grade_level', distinct)
    .order('last_name')
    .order('first_name');

  return (data ?? []).map((row) => ({
    id: row.id as string,
    firstName: (row.first_name as string) ?? '',
    lastName: (row.last_name as string) ?? '',
    gradeLevel: row.grade_level as number,
  }));
}

/** The class for one material. */
export async function rosterFor(material: OwnedMaterial): Promise<RosterStudent[]> {
  return rosterForGrades(material.gradeLevels);
}

/** One student, only if active and in this material's class. IDOR guard; re-derives role, status and grade. */
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
