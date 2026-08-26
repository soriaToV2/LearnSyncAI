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
 * Proves the password AND returns a client holding the resulting session, for the
 * operations that must run as the user rather than as the service role.
 *
 * ⚠️ AN `Authorization` HEADER IS NOT A SESSION, AND THAT COST A ROUND OF
 * DEBUGGING. The first version of this built a client with
 * `global.headers.Authorization = Bearer <jwt>` and called `updateUser()` on it.
 * That fails with **"Auth session missing!"**: `updateUser` does not read the
 * header, it calls `_useSession()` and reads the session off the client instance.
 * Measured against this project — header-only `ERROR: Auth session missing!`,
 * same-client-after-sign-in `OK`, explicit `setSession()` `OK`.
 *
 * Signing in is what puts the session there, and this route already had to sign
 * in to verify the current password — so reusing that client is both the fix and
 * one fewer round trip than verifying and then acting separately.
 *
 * ⚠️ `updateUser({ email })` IS THE WHOLE POINT. `admin.updateUserById({ email })`
 * applies an address outright with no confirmation, which is the behaviour being
 * replaced; the user-scoped call mails a code to the new address and applies
 * nothing until `verifyOtp` redeems it.
 *
 * Returns null on ANY sign-in failure, with the same no-distinguishing rule as
 * `signInWithPassword` above.
 *
 * Built per call, for the reason at the top of this file — with
 * `persistSession: false` supabase-js keeps the session in an in-memory adapter,
 * so it lives and dies with this client and never leaks into another request.
 */
export async function sessionClientForPassword(email: string, password: string) {
  const client = ephemeralClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) return null;
  return client;
}

/**
 * A throwaway client with NO session at all, for the unauthenticated recovery
 * routes.
 *
 * `resetPasswordForEmail()` and `verifyOtp({ type: 'recovery' })` are called by
 * someone who by definition cannot sign in, so there is no token to carry. It is
 * a distinct export rather than an exported `ephemeralClient` because the two
 * read differently at a call site: this one is anonymous ON PURPOSE, and that is
 * worth stating where it is used.
 */
export function ephemeralAnonClient() {
  return ephemeralClient();
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
