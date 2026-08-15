import { supabase } from './supabase';

/**
 * Ends the Supabase session.
 *
 * ⚠️ NOTHING CALLED THIS BEFORE, AND BOTH PORTALS SHIPPED A LOGOUT THAT DID NOT
 * LOG OUT. Each sidebar rendered `<NavLink to="/login">`, which changes the URL
 * and nothing else: the session stayed in localStorage, `api.ts` kept attaching a
 * valid JWT on every call, and typing `/student/dashboard` in the address bar put
 * you straight back into the account. On a shared school computer the next student
 * inherited the session.
 *
 * ONE implementation for both portals on purpose. A sign-out sequence copied into
 * two layout files is the drift this codebase keeps warning about, and the failure
 * mode here is silent — a portal that skips a step leaves a live session behind
 * with no visible symptom.
 *
 * It deliberately does NOT navigate. Redirecting belongs to the caller, which has
 * the router; this keeps the module usable from anywhere and keeps the
 * `replace: true` decision at the call site where it can be read.
 *
 * NOT part of `AuthContext`. That file states it is "deliberately thin — identity
 * and nothing else", and it is mounted per-layout, so a sign-out living there
 * would be unreachable from anything outside a portal shell.
 */
export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}
