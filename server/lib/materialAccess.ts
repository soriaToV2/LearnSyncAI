/**
 * Who may read which material. The service role bypasses RLS, so every route taking a material id
 * must check here.
 *   student  -> not archived and published to their grade
 *   educator -> their own uploads, archived or not
 *   admin    -> everything
 *   disabled -> nothing
 */

import { Request, Response, NextFunction, RequestHandler } from 'express';
import { supabaseAdmin } from './supabase';
import { UserRole } from '../types/database';

/** So a junk id 404s instead of 500ing. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | undefined): boolean {
  return typeof value === 'string' && UUID_RE.test(value);
}

interface Caller {
  role: UserRole;
  gradeLevel: number | null;
}

/** Active profile for this user, or null if missing or disabled. */
async function loadCaller(userId: string): Promise<Caller | null> {
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('role, status, grade_level')
    .eq('id', userId)
    .maybeSingle();

  if (!data || data.status !== 'active') return null;
  return { role: data.role as UserRole, gradeLevel: data.grade_level ?? null };
}

/** The subset of `materialIds` this user may read, in one query. */
export async function accessibleMaterialIds(
  userId: string,
  materialIds: string[]
): Promise<Set<string>> {
  const ids = [...new Set(materialIds.filter(isUuid))];
  if (ids.length === 0) return new Set();

  const caller = await loadCaller(userId);
  if (!caller) return new Set();

  let query = supabaseAdmin.from('materials').select('id').in('id', ids);

  if (caller.role === 'student') {
    // A student with no grade level on file qualifies for nothing.
    if (caller.gradeLevel === null) return new Set();
    // `contains` compiles to @>, which uses the GIN index on grade_levels.
    query = query.eq('is_archived', false).contains('grade_levels', [caller.gradeLevel]);
  } else if (caller.role === 'educator') {
    query = query.eq('educator_id', userId);
  }
  // admin: no extra filter.

  const { data, error } = await query;
  if (error || !data) return new Set();

  return new Set(data.map((row) => row.id as string));
}

/** True when every id is readable by this user. Empty input is vacuously true. */
export async function canReadAllMaterials(userId: string, materialIds: string[]): Promise<boolean> {
  const unique = [...new Set(materialIds)];
  if (unique.length === 0) return true;
  const allowed = await accessibleMaterialIds(userId, unique);
  return unique.every((id) => allowed.has(id));
}

/** Guard for a material id in the path. Answers 404, never 403, so ids can't be probed. */
export function requireMaterialAccess(param: string = 'id'): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const materialId = req.params[param];

    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized', message: 'Not authenticated' });
      return;
    }

    const allowed = await accessibleMaterialIds(req.user.id, [materialId]);
    if (!allowed.has(materialId)) {
      res.status(404).json({ error: 'Material not found' });
      return;
    }

    next();
  };
}

/** For material id arrays in a body: sends 403 and returns false if any id is off-limits. Return immediately. */
export async function rejectInaccessibleMaterials(
  req: Request,
  res: Response,
  materialIds: string[]
): Promise<boolean> {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized', message: 'Not authenticated' });
    return false;
  }

  if (await canReadAllMaterials(req.user.id, materialIds)) return true;

  res.status(403).json({
    error: 'Forbidden',
    message: 'One or more of the selected materials is not available to you.',
  });
  return false;
}

/** Non-archived materials published to a subject and grade. Archiving hides them without touching link rows. */
export async function publishedMaterialIds(subject: string, gradeLevel: number): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('materials')
    .select('id')
    .eq('subject', subject)
    .eq('is_archived', false)
    .contains('grade_levels', [gradeLevel]);

  if (error || !data) return [];
  return data.map((row) => row.id as string);
}
