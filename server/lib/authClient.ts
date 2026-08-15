import { createClient, type Session } from '@supabase/supabase-js';

/**
 * Password verification, on a throwaway client.
 *
 * ⚠️ NEVER SIGN IN ON `supabaseAdmin` OR THE EXPORTED `supabaseAnon`. Both are
 * process-wide singletons, and a successful `signInWithPassword` stores the
 * resulting session on the client instance. On `supabaseAdmin` that is a live
 * hazard: every later `.from()` in the process could run as that user instead of
 * the service role, silently reinstating RLS on queries written to bypass it —
 * and it would fail intermittently, only for requests unlucky enough to land
 * after a login. A fresh client per call has no shared state to leak.
 *
 * THIS IS THE DOCUMENTED EXCEPTION TO "never use the Supabase anon client on the
 * server". That rule is about DB access: the anon key respects RLS, so a query
 * made with it silently returns fewer rows than the code expects. This module
 * issues no queries — it calls the auth endpoint and nothing else — and the anon
 * key is the correct credential for a password grant. Do not add a `.from()`
 * here; if a route needs data, it uses `supabaseAdmin`.
 *
 * `persistSession` and `autoRefreshToken` are both off. There is no storage on a
 * server and nothing to refresh: the session is handed straight to the caller,
 * or discarded once the password has been proven.
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
 * Signs in with an email and password.
 *
 * Returns the session on success and `null` on ANY failure — wrong password,
 * unknown address, unconfirmed account. Callers must not distinguish between
 * them in what they send back: `POST /api/auth/login` is unauthenticated, so a
 * response that separates "no such user" from "wrong password" turns it into an
 * oracle for which usernames exist.
 */
export async function signInWithPassword(
  email: string,
  password: string
): Promise<Session | null> {
  const { data, error } = await ephemeralClient().auth.signInWithPassword({ email, password });
  if (error || !data.session) return null;
  return data.session;
}

/**
 * Proves the caller knows their own password, for a credential change.
 *
 * Identical mechanics to signing in, named separately because the intent differs
 * and the session is deliberately thrown away — reading `verifyPassword(...)` at
 * a call site should not raise the question of what happened to the session it
 * created.
 */
export async function verifyPassword(email: string, password: string): Promise<boolean> {
  return (await signInWithPassword(email, password)) !== null;
}
