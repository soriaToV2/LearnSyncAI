import { createClient, SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Resolve __dirname in ESM context
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from the project root (two levels up from server/lib/)
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function getSupabaseUrl(): string {
  const url = process.env.SUPABASE_URL;
  if (!url) throw new Error('Missing env variable: SUPABASE_URL');
  return url;
}

function getAnonKey(): string {
  const key = process.env.SUPABASE_ANON_KEY;
  if (!key) throw new Error('Missing env variable: SUPABASE_ANON_KEY');
  return key;
}

function getServiceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    console.warn(
      '⚠️  SUPABASE_SERVICE_ROLE_KEY is not set. Admin operations will use the anon key.\n' +
      '   Get it from: Supabase Dashboard → Project Settings → API → service_role key'
    );
    return getAnonKey();
  }
  return key;
}

/**
 * Anon client — respects Row Level Security (RLS).
 * Use for operations that should behave like a logged-in user.
 */
export const supabaseAnon: SupabaseClient = createClient(getSupabaseUrl(), getAnonKey());

/**
 * Admin client — bypasses Row Level Security (RLS).
 * Use ONLY on the server side for privileged operations like:
 *  - Verifying user JWTs
 *  - Background jobs
 *  - Admin data access
 *
 * ⚠️  NEVER expose this client or its key to the browser/frontend.
 */
export const supabaseAdmin: SupabaseClient = createClient(
  getSupabaseUrl(),
  getServiceRoleKey(),
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);
