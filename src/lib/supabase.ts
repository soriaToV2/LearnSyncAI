import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    '⚠️ Missing Supabase environment variables.\n' +
    'Make sure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set in your .env file.'
  );
}

/**
 * Supabase client for the frontend (browser).
 *
 * Use this for:
 *  - Authentication: signUp, signInWithPassword, signOut
 *  - Reading the current session/JWT: supabase.auth.getSession()
 *  - Real-time subscriptions (future)
 *
 * ⚠️  This uses the ANON key and respects Row Level Security.
 *     For protected data, always go through the Express API (/api/*)
 *     rather than querying Supabase directly from the frontend.
 */
export const supabase = createClient(supabaseUrl ?? '', supabaseAnonKey ?? '');
