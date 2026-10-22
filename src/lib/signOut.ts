import { supabase } from './supabase';

/** Ends the Supabase session. Callers handle the redirect. */
export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}
