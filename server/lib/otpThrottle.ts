/**
 * Rate limiting for the unauthenticated recovery routes, keyed by username (all traffic shares the
 * server's IP). In-memory and per-process, assuming a single instance. Not a security boundary:
 * Supabase owns the codes; this only limits volume.
 */

const SEND_COOLDOWN_MS = 60_000;

const SEND_WINDOW_MS = 60 * 60_000;
const MAX_SENDS_PER_WINDOW = 5;

/** Wrong codes allowed before verification locks until a new code is sent. */
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

/** Bounds memory, since keys are attacker-supplied. Swept on write. */
const MAX_KEYS = 5_000;

function sweep<T>(map: Map<string, T>, isStale: (value: T) => boolean): void {
  if (map.size < MAX_KEYS) return;
  for (const [key, value] of map) {
    if (isStale(value)) map.delete(key);
  }
  // Still full: drop the oldest half. Failing open (one extra mail) is acceptable here.
  if (map.size >= MAX_KEYS) {
    let n = Math.floor(map.size / 2);
    for (const key of map.keys()) {
      if (n-- <= 0) break;
      map.delete(key);
    }
  }
}

/**
 * Whether a code may be sent now; record sends with noteSend(). The reason is for logs only,
 * never the response, or it would confirm the username exists.
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

  // A new code invalidates the old one, so reset its attempt counter.
  verifies.delete(username);
}

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

/** Clears both counters after a successful reset. */
export function clearThrottle(username: string): void {
  sends.delete(username);
  verifies.delete(username);
}
