import { supabaseAdmin } from './supabase';

/**
 * Derives an unused username from a name, for the admin Generate button and CSV import.
 * Uniqueness here is a courtesy; `ux_profiles_username_lower` and createAccount() are the guarantee.
 */

/** Mirrors `profiles_username_format` in schema.sql. */
const USERNAME_RE = /^[a-z0-9][a-z0-9._]{1,28}[a-z0-9]$/;
const MAX_LENGTH = 30;

/** Combining diacritics, written escaped because the raw characters are invisible. */
const COMBINING_MARKS = new RegExp('[\\u0300-\\u036f]', 'g');

/** Folds a name part to username characters; NFD keeps `Niño` as `nino`, not `nio`. */
function fold(part: string): string {
  return part
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * `first.last`, trimmed to fit; `reserve` leaves room for a numeric suffix.
 * Returns null rather than inventing a fallback like `user1234`.
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
    // Trim the surname first; a truncated given name reads as a typo.
    const room = budget - first.length - 1;
    candidate = room >= 1 ? `${first}.${last.slice(0, room)}` : first.slice(0, budget);
  }

  // A trailing dot is legal input but not a legal username.
  candidate = candidate.replace(/[._]+$/, '');

  // Pad names shorter than the 3-character minimum.
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
 * An unused username from the name, or null. `extraTaken` holds names claimed earlier in the
 * same batch but not yet written.
 */
export async function suggestUsername(
  firstName: string,
  lastName: string,
  extraTaken: Set<string> = new Set()
): Promise<string | null> {
  const base = buildUsername(firstName, lastName);
  if (!base) return null;

  if (!(await isTaken(base, extraTaken))) return base;

  // Try name2, name3, … up to a finite bound.
  for (let n = 2; n <= 99; n++) {
    const suffix = String(n);
    const stem = buildUsername(firstName, lastName, suffix.length) ?? base;
    const candidate = `${stem}${suffix}`;
    if (!USERNAME_RE.test(candidate)) continue;
    if (!(await isTaken(candidate, extraTaken))) return candidate;
  }

  return null;
}
