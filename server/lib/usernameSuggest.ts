import { supabaseAdmin } from './supabase';

/**
 * Derive a valid, unused username from a person's name.
 *
 * Shared by `POST /api/admin/username-suggestion` (the Generate button beside the
 * username field) and the bulk CSV importer, which fills in blank username
 * columns. One implementation, because a school with two naming conventions has
 * a naming convention problem.
 *
 * ⚠️ UNIQUENESS HERE IS A COURTESY, NOT THE GUARANTEE. Two admins importing at
 * the same moment can both be handed the same free name. `ux_profiles_username_lower`
 * is the arbiter, and `createAccount()` in `admin.routes.ts` already re-reads the
 * created row and repairs or rolls back when it loses that race. Do not add
 * locking here to close a gap that is already closed downstream.
 */

/** Mirrors `profiles_username_format` in schema.sql. */
const USERNAME_RE = /^[a-z0-9][a-z0-9._]{1,28}[a-z0-9]$/;
const MAX_LENGTH = 30;

/**
 * The Unicode combining-diacritic block, built from an escaped string rather than
 * a regex literal: the characters themselves are invisible in an editor and are
 * easily mangled by a re-encode or a careless copy-paste.
 */
const COMBINING_MARKS = new RegExp('[\\u0300-\\u036f]', 'g');

/**
 * Fold one name part to the characters a username may contain.
 *
 * `normalize('NFD')` splits an accented letter into its base plus a combining
 * mark, which the following strip then removes — so `Niño` becomes `nino` rather
 * than `nio`. This matters: Filipino names carry `ñ` routinely, and dropping the
 * letter outright produces a username the student will not recognise as theirs.
 * Hyphens and apostrophes (`Santos-Reyes`, `D'Souza`) are simply removed.
 */
function fold(part: string): string {
  return part
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * `first.last`, trimmed to fit — the style chosen for this deployment.
 *
 * Returns null when there is nothing usable to build from, so the caller can ask
 * the admin to type one. **Never invent a fallback like `user1234`**: a username
 * that carries no trace of the person's name is one nobody can recognise on a
 * class list, and it would be handed out without anyone noticing it was a
 * placeholder.
 *
 * `reserve` leaves room for a numeric suffix so that appending one in
 * `suggestUsername()` cannot push the result past the 30-character limit.
 */
export function buildUsername(
  firstName: string,
  lastName: string,
  reserve = 0
): string | null {
  const first = fold(firstName);
  const last = fold(lastName);

  if (!first && !last) return null;

  const budget = MAX_LENGTH - reserve;
  let candidate: string;

  if (!first) candidate = last.slice(0, budget);
  else if (!last) candidate = first.slice(0, budget);
  else {
    // Trim the surname first — a truncated given name reads as a typo, while a
    // shortened surname still reads as the person.
    const room = budget - first.length - 1;
    candidate = room >= 1 ? `${first}.${last.slice(0, room)}` : first.slice(0, budget);
  }

  // A trailing dot is legal input but not a legal username.
  candidate = candidate.replace(/[._]+$/, '');

  // The floor is 3 characters; pad a very short name rather than returning
  // something the CHECK constraint would reject outright.
  if (candidate.length < 3) candidate = `${candidate}${last || first}`.slice(0, budget);
  if (candidate.length < 3 || !USERNAME_RE.test(candidate)) return null;

  return candidate;
}

/** Case-insensitive, matching `ux_profiles_username_lower`. */
async function isTaken(username: string, extraTaken: Set<string>): Promise<boolean> {
  if (extraTaken.has(username)) return true;
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .ilike('username', username)
    .limit(1);
  return (data?.length ?? 0) > 0;
}

/**
 * A username derived from the name that nothing currently holds.
 *
 * `extraTaken` carries names claimed earlier in the same batch but not yet
 * written — without it, a CSV containing two students called Maria Santos would
 * be handed `maria.santos` twice and the second insert would fail mid-import.
 *
 * Returns null when no usable base can be derived; the caller reports that to the
 * admin rather than inventing one.
 */
export async function suggestUsername(
  firstName: string,
  lastName: string,
  extraTaken: Set<string> = new Set()
): Promise<string | null> {
  const base = buildUsername(firstName, lastName);
  if (!base) return null;

  if (!(await isTaken(base, extraTaken))) return base;

  /*
   * Try `name2`, `name3`, … The bound is arbitrary but finite: 99 people sharing
   * one folded name at a single junior high school is not a case to design for,
   * and an unbounded loop against the database is worse than a readable failure.
   */
  for (let n = 2; n <= 99; n++) {
    const suffix = String(n);
    const stem = buildUsername(firstName, lastName, suffix.length) ?? base;
    const candidate = `${stem}${suffix}`;
    if (!USERNAME_RE.test(candidate)) continue;
    if (!(await isTaken(candidate, extraTaken))) return candidate;
  }

  return null;
}
