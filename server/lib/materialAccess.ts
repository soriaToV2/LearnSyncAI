/**
 * Who may read which material.
 *
 * Migration 0008 spells out why this file has to exist: the Express API talks to
 * Postgres with the service role key, which bypasses Row-Level Security by
 * design, so "the API layer must still enforce role and ownership itself". The
 * RLS policies are defence-in-depth against direct anon-key access; they do
 * nothing for a request that arrives here.
 *
 * The rule comes straight from the paper: educators "select which grade level can
 * access" each upload, and the Material Ingestion and Distribution Core "makes
 * the processed content available to students within the educator's selected
 * grade level". So:
 *
 *   student  -> materials that are not archived and list their grade_level
 *   educator -> their own uploads, archived or not
 *   admin    -> everything (read-only elsewhere)
 *   disabled -> nothing, whatever the role says
 *
 * Every route a student can reach with a material id routes through here. Before
 * this existed, any signed-in user could pass any material id to /view, /concepts
 * or /status and get another grade's content back.
 */

import { Request, Response, NextFunction, RequestHandler } from 'express';
import { supabaseAdmin } from './supabase';
import { UserRole } from '../types/database';

/** Matches the uuid format Postgres will accept, so a junk id 404s instead of 500ing. */
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

/**
 * Narrows `materialIds` to the ones this user is actually allowed to read.
 *
 * Returns a Set rather than a boolean so a caller holding several ids can tell
 * *which* were rejected, and so the check costs one query no matter how many ids
 * are passed. An empty input returns an empty Set without touching the database.
 */
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
    // grade_levels is smallint[]; `contains` compiles to @>, which uses the
    // existing GIN index idx_materials_grade_levels.
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

/**
 * Route guard for endpoints that name a single material in the path.
 *
 * Answers 404, never 403: a 403 would confirm that the id names a real material,
 * which is itself a disclosure. From outside, an inaccessible material and a
 * non-existent one are indistinguishable.
 */
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

/**
 * Body-parameter equivalent of the guard above, for routes that take an array of
 * material ids. Responds 403 and returns false when any id is off-limits; the
 * caller should return immediately.
 *
 * 403 rather than 404 here because these routes are only ever reached with ids
 * the client already listed from its own study space — a mismatch means the
 * client is asking for something it was never shown.
 */
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

/**
 * Materials published to a subject at a grade level — the derived contents of a
 * study space. Archived materials are excluded, which is what makes an educator's
 * archive action remove the material from every student's space without touching
 * study_space_materials.
 */
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
