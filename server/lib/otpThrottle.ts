/**
 * Rate limiting for the two unauthenticated recovery routes.
 *
 * ⚠️ KEYED BY USERNAME, NOT BY IP, AND THAT IS NOT A SHORTCUT. Every request in
 * this deployment arrives from the server's own address — the frontend calls
 * Express, Express calls Supabase — so an IP key would put all fifty students in
 * one bucket and the first whole-class login rush would lock the rest out. The
 * same property is already recorded in CLAUDE.md as a live hazard for Supabase's
 * own IP-based auth limits.
 *
 * What that buys and what it does not: keying by username stops someone
 * mail-bombing ONE child's inbox with a username they know, and stops a code
 * being brute-forced. It does NOT stop a distributed sweep across many usernames,
 * because there is no shared identifier to key that on. `express-rate-limit`
 * behind a real proxy header is the fix for that and is deliberately out of scope.
 *
 * ⚠️ PER-PROCESS AND DELIBERATELY SO. An in-memory Map follows the process-lifetime
 * cache precedent in `bkt.ts`. A Render free-tier spin-down clears it, so the
 * worst case after a cold start is one extra mail — set against a Redis dependency
 * for a fifty-student study, that is the right trade. It also means a multi-instance
 * deployment would multiply every limit by the instance count; single-instance is
 * an assumption here, not an accident.
 *
 * NOTHING HERE IS A SECURITY BOUNDARY ON ITS OWN. Supabase mints, hashes, expires
 * and single-uses the codes themselves. This only blunts the volume.
 */

/** One minute between sends, so a double-clicked button cannot mail twice. */
const SEND_COOLDOWN_MS = 60_000;

/** Five sends an hour for one username — enough for genuine retries, not a flood. */
const SEND_WINDOW_MS = 60 * 60_000;
const MAX_SENDS_PER_WINDOW = 5;

/**
 * Five wrong codes and this username stops accepting any until a new one is sent.
 *
 * A 6-digit code is a million combinations, and there is no `express-rate-limit`
 * in this project — without a cap, a script could walk the space against a known
 * username. Five is generous for someone reading a code off a phone.
 */
const MAX_VERIFY_ATTEMPTS = 5;
const VERIFY_WINDOW_MS = 15 * 60_000;

interface SendRecord {
  /** Epoch ms of each send inside the rolling window. */
  sentAt: number[];
}

interface VerifyRecord {
  failures: number;
  firstFailureAt: number;
}

const sends = new Map<string, SendRecord>();
const verifies = new Map<string, VerifyRecord>();

/**
 * Bounds memory on a map keyed by attacker-supplied strings.
 *
 * Without this, sweeping usernames would grow the maps without limit — a slow
 * memory leak driven from outside. Swept on write, which is enough at this scale
 * and needs no timer.
 */
const MAX_KEYS = 5_000;

function sweep<T>(map: Map<string, T>, isStale: (value: T) => boolean): void {
  if (map.size < MAX_KEYS) return;
  for (const [key, value] of map) {
    if (isStale(value)) map.delete(key);
  }
  /*
   * Still full of live entries after sweeping the stale ones: drop the oldest
   * half by insertion order (Map preserves it). Losing a limiter entry fails
   * OPEN — one extra mail — which is the correct direction for a recovery flow.
   */
  if (map.size >= MAX_KEYS) {
    let n = Math.floor(map.size / 2);
    for (const key of map.keys()) {
      if (n-- <= 0) break;
      map.delete(key);
    }
  }
}

/**
 * May a code be sent for this username right now?
 *
 * Call it BEFORE sending and record the send with `noteSend()` after. Returns a
 * reason for the log only — ⚠️ THE ROUTE MUST NOT PUT IT IN THE RESPONSE.
 * `POST /forgot-password` answers identically whatever happens, and "you are
 * being rate limited" would confirm that the username exists.
 */
export function canSend(username: string): { allowed: boolean; reason?: string } {
  const now = Date.now();
  const record = sends.get(username);
  if (!record) return { allowed: true };

  const recent = record.sentAt.filter((t) => now - t < SEND_WINDOW_MS);
  if (recent.length === 0) return { allowed: true };

  const last = Math.max(...recent);
  if (now - last < SEND_COOLDOWN_MS) {
    return { allowed: false, reason: 'cooldown' };
  }
  if (recent.length >= MAX_SENDS_PER_WINDOW) {
    return { allowed: false, reason: 'hourly cap' };
  }
  return { allowed: true };
}

export function noteSend(username: string): void {
  const now = Date.now();
  const record = sends.get(username);
  const recent = (record?.sentAt ?? []).filter((t) => now - t < SEND_WINDOW_MS);
  recent.push(now);
  sends.set(username, { sentAt: recent });
  sweep(sends, (v) => v.sentAt.every((t) => now - t >= SEND_WINDOW_MS));

  /*
   * A fresh code invalidates the previous one at Supabase, so the attempt counter
   * for the old one is meaningless — and leaving it would let a few honest typos
   * lock out a user who then correctly asked for a new code.
   */
  verifies.delete(username);
}

/** Has this username burned its attempts on the current code? */
export function canVerify(username: string): boolean {
  const record = verifies.get(username);
  if (!record) return true;
  if (Date.now() - record.firstFailureAt >= VERIFY_WINDOW_MS) {
    verifies.delete(username);
    return true;
  }
  return record.failures < MAX_VERIFY_ATTEMPTS;
}

export function noteVerifyFailure(username: string): void {
  const now = Date.now();
  const record = verifies.get(username);
  if (!record || now - record.firstFailureAt >= VERIFY_WINDOW_MS) {
    verifies.set(username, { failures: 1, firstFailureAt: now });
  } else {
    record.failures += 1;
  }
  sweep(verifies, (v) => now - v.firstFailureAt >= VERIFY_WINDOW_MS);
}

/** Clears both counters. Called once a reset actually succeeds. */
export function clearThrottle(username: string): void {
  sends.delete(username);
  verifies.delete(username);
}
