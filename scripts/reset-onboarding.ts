/**
 * Clears a student's onboarding progress so the first-run tour and the six
 * study-tool panels all appear again.
 *
 *   npx tsx scripts/reset-onboarding.ts student          # by username
 *   npx tsx scripts/reset-onboarding.ts student tour     # just the tour
 *   npx tsx scripts/reset-onboarding.ts --list           # who has seen what
 *
 * WHY THIS EXISTS. Onboarding is remembered per account in `onboarding_seen`,
 * which is exactly what makes it work on a shared school computer — and exactly
 * what makes it impossible to test twice without either a fresh account or this
 * script. Clearing site data does nothing, because nothing is stored in the
 * browser.
 *
 * ⚠️ THIS IS WHY THERE IS NO DELETE ENDPOINT. Resetting is a developer action.
 * A route a student could reach would let them clear a record whose only purpose
 * is to stop the app pestering them.
 *
 * ⚠️ WRITES TO THE CONFIGURED SUPABASE PROJECT. A verification tool, not
 * something to run during the live study.
 */
import { supabaseAdmin } from '../server/lib/supabase';

const [rawUsername, scope] = process.argv.slice(2);

function usage(message: string): never {
  console.error(`\n${message}\n`);
  console.error('Usage: npx tsx scripts/reset-onboarding.ts <username> [tour|tools]');
  console.error('       npx tsx scripts/reset-onboarding.ts --list');
  process.exit(1);
}

async function list(): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('onboarding_seen')
    .select('student_id, step_key, seen_at')
    .order('seen_at');

  if (error) {
    console.error('Could not read onboarding_seen:', error.message);
    process.exit(1);
  }

  const rows = data ?? [];
  if (rows.length === 0) {
    console.log('\nNo onboarding progress recorded for anybody yet.\n');
    return;
  }

  // Resolve the ids in one query rather than per row.
  const ids = [...new Set(rows.map((r) => r.student_id as string))];
  const { data: people } = await supabaseAdmin
    .from('profiles')
    .select('id, username, first_name, last_name')
    .in('id', ids);

  const nameOf = new Map(
    (people ?? []).map((p) => [
      p.id as string,
      `${p.username ?? '(no username)'} — ${p.first_name} ${p.last_name}`,
    ])
  );

  const byStudent = new Map<string, string[]>();
  for (const row of rows) {
    const key = nameOf.get(row.student_id as string) ?? (row.student_id as string);
    byStudent.set(key, [...(byStudent.get(key) ?? []), row.step_key as string]);
  }

  console.log('');
  for (const [student, keys] of byStudent) {
    console.log(`  ${student}`);
    console.log(`      ${keys.join(', ')}`);
  }
  console.log('');
}

async function main(): Promise<void> {
  if (!rawUsername) usage('Say whose onboarding to reset.');
  if (rawUsername === '--list') return list();

  if (scope && scope !== 'tour' && scope !== 'tools') {
    usage(`"${scope}" is not a scope. Use "tour", "tools", or leave it off for everything.`);
  }

  const username = rawUsername.toLowerCase();

  const { data: profile, error: lookupError } = await supabaseAdmin
    .from('profiles')
    .select('id, username, first_name, last_name, role')
    .ilike('username', username)
    .maybeSingle();

  if (lookupError) {
    console.error('Lookup failed:', lookupError.message);
    process.exit(1);
  }
  if (!profile) usage(`No account with the username "${rawUsername}".`);

  if (profile.role !== 'student') {
    usage(
      `${profile.username} is ${profile.role === 'admin' ? 'an' : 'a'} ${profile.role}. ` +
        'Only the student portal has onboarding.'
    );
  }

  let query = supabaseAdmin.from('onboarding_seen').delete().eq('student_id', profile.id);

  // `tour_v1` and any future `tour_v2` share the prefix, so a scoped reset does
  // not need updating when the tour is versioned.
  if (scope === 'tour') query = query.like('step_key', 'tour%');
  if (scope === 'tools') query = query.like('step_key', 'tool_%');

  const { data: deleted, error } = await query.select('step_key');

  if (error) {
    console.error('Delete failed:', error.message);
    process.exit(1);
  }

  const keys = (deleted ?? []).map((r) => r.step_key as string);
  const label = scope ? `${scope} ` : '';

  console.log(
    `\nCleared ${keys.length} ${label}onboarding row(s) for ` +
      `${profile.username} (${profile.first_name} ${profile.last_name}).`
  );
  if (keys.length > 0) console.log(`  ${keys.join(', ')}`);
  console.log('\nReload the student portal to see them again.\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
