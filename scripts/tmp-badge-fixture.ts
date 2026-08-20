import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../server/lib/supabase';

/**
 * Sets up a throwaway student so the badge-earned modal can be clicked through
 * in a real browser, and verifies the endpoint the modal reads.
 *
 *   npx tsx scripts/tmp-badge-fixture.ts          create + verify
 *   npx tsx scripts/tmp-badge-fixture.ts cleanup  delete it
 */

const API = 'http://localhost:5000/api';
const PASSWORD = 'badge-demo-99!';
const MARKER = 'badgedemo';

const ephemeral = () =>
  createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

async function cleanup() {
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('id, username')
    .like('username', `${MARKER}%`);

  for (const p of data ?? []) {
    const { error } = await supabaseAdmin.auth.admin.deleteUser(p.id as string);
    console.log(`  ${p.username}: ${error ? 'FAILED ' + error.message : 'deleted'}`);
  }
  if ((data ?? []).length === 0) console.log('  nothing to clean up');
}

async function main() {
  if (process.argv[2] === 'cleanup') {
    console.log('=== CLEANUP ===');
    await cleanup();
    process.exit(0);
  }

  console.log('=== CREATING THROWAWAY STUDENT ===');
  const username = `${MARKER}${Date.now().toString().slice(-5)}`;
  const email = `${username}@pca.invalid`;

  const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: {
      first_name: 'Badge',
      last_name: 'Demo',
      role: 'student',
      grade_level: 9,
      username,
    },
  });
  if (error) throw error;
  const studentId = created.user!.id;

  // Skip the first-login gate so the account can be used immediately.
  await supabaseAdmin.from('profiles').update({ must_change_password: false }).eq('id', studentId);

  // Verify the endpoint the modal reads returns the NEW shape.
  const { data: signIn, error: signErr } = await ephemeral().auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (signErr) throw signErr;
  const token = signIn.session!.access_token;

  const res = await fetch(`${API}/gamification/badges`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json();
  const shapeOk = Array.isArray(body.data);
  console.log(`\n  GET /gamification/badges -> HTTP ${res.status}, ${JSON.stringify(body.data)}`);
  console.log(`  returns an array: ${shapeOk ? 'yes' : 'NO'}`);

  // Award one badge directly so the shape can be inspected with real content.
  await supabaseAdmin
    .from('user_badges')
    .insert({ student_id: studentId, badge_name: 'first_recall' });
  const res2 = await fetch(`${API}/gamification/badges`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body2 = await res2.json();
  const row = body2.data?.[0];
  console.log(`  with one badge      -> ${JSON.stringify(row)}`);
  console.log(`  key is \`name\` not \`badge_name\`: ${row && 'name' in row && !('badge_name' in row) ? 'YES' : 'NO'}`);

  // Remove it again so the click-through starts from zero badges.
  await supabaseAdmin.from('user_badges').delete().eq('student_id', studentId);

  console.log(`
=== SIGN IN AT http://localhost:3000/login ===

    username: ${username}
    password: ${PASSWORD}

  Grade 9, so the three ENG materials are visible. A study space is NOT
  created — make one to check that flow too, or the modal will have nothing
  to fire on.

  What to try:
    1. Flashcards -> new deck -> generate (term) -> study one card to the
       results screen        => "First Review", confetti
    2. Games -> play one to 100%
                              => ONE modal, two badges, staggered
    3. Dismiss with the button, with Escape, and by clicking the backdrop
    4. Reload the page        => nothing pops (baseline re-seeds)
    5. Rate another flashcard => nothing pops (already held)
    6. OS "reduce motion" on, repeat 1 => modal appears, no confetti/pop

  When finished:
    npx tsx scripts/tmp-badge-fixture.ts cleanup
`);

  process.exit(0);
}

main().catch(async (err) => {
  console.error('FIXTURE THREW:', err);
  await cleanup().catch(() => {});
  process.exit(1);
});
