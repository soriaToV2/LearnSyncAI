import { createClient, type Session } from '@supabase/supabase-js';

/**
 * A throwaway anon client per call, for auth endpoints only.
 * Never sign in on `supabaseAdmin` or a shared client: the session would stick to the singleton.
 * This is the one permitted server use of the anon key; never add a `.from()` here.
 */
function ephemeralClient() {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY — required for password sign-in');
  }
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/**
 * Verifies the password and returns a client holding the user's session (null on any failure),
 * for calls that must run as the user, e.g. `updateUser({ email })`.
 * A bearer header is not enough: `updateUser` reads the session off the client instance.
 */
export async function sessionClientForPassword(email: string, password: string) {
  const client = ephemeralClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) return null;
  return client;
}

/** A session-less client for the unauthenticated recovery routes. */
export function ephemeralAnonClient() {
  return ephemeralClient();
}

/**
 * Returns the session, or null on any failure. Callers must not reveal which failure occurred,
 * or login becomes a username oracle.
 */
export async function signInWithPassword(
  email: string,
  password: string
): Promise<Session | null> {
  const { data, error } = await ephemeralClient().auth.signInWithPassword({ email, password });
  if (error || !data.session) return null;
  return data.session;
}

/** Proves the caller knows their password; the session is discarded. */
export async function verifyPassword(email: string, password: string): Promise<boolean> {
  return (await signInWithPassword(email, password)) !== null;
}
