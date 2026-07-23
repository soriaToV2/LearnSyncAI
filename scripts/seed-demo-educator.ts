/**
 * Seeds a demo educator account for local development.
 *
 *   npx tsx scripts/seed-demo-educator.ts
 *
 * The account is created through the Supabase Auth admin API rather than raw SQL
 * so that auth.users, auth.identities and public.profiles stay consistent. The
 * handle_new_user() trigger reads role/first_name/last_name out of user_metadata
 * and creates the profiles row (and correctly skips gamification_profiles, which
 * only students get).
 *
 * No teaching load is seeded. Educators are not pre-assigned to subjects or
 * grades — they choose both per upload — so the account can publish the moment
 * it exists.
 *
 * Safe to re-run: if the email already exists the account is reused.
 */
import { supabaseAdmin } from '../server/lib/supabase';

const DEMO = {
  email: 'liza.mendoza@pca.edu.ph',
  password: 'LearnSync!2026',
  first_name: 'Liza',
  last_name: 'Mendoza',
};

async function findExistingUserId(email: string): Promise<string | null> {
  // listUsers is paginated; the dev project has a handful of accounts, so one
  // generous page is plenty. Its return type is a union whose `users` member
  // narrows to never[] under structural intersection, hence the explicit cast.
  const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) throw new Error(`Could not list users: ${error.message}`);

  const users = data.users as Array<{ id: string; email?: string }>;
  return users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id ?? null;
}

async function main(): Promise<void> {
  console.log(`\nSeeding demo educator: ${DEMO.email}`);

  let userId = await findExistingUserId(DEMO.email);

  if (userId) {
    console.log(`  • Account already exists (${userId}) — reusing it.`);
  } else {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: DEMO.email,
      password: DEMO.password,
      email_confirm: true,
      user_metadata: {
        role: 'educator',
        first_name: DEMO.first_name,
        last_name: DEMO.last_name,
      },
    });

    if (error || !data.user) {
      throw new Error(`Failed to create auth user: ${error?.message ?? 'no user returned'}`);
    }

    userId = data.user.id;
    console.log(`  • Created auth user ${userId}`);
  }

  // The trigger creates the profile. Verify it landed with the right role rather
  // than assuming — a silent trigger failure would otherwise show up much later.
  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('id, first_name, last_name, role, grade_level, status')
    .eq('id', userId)
    .single();

  if (profileError || !profile) {
    throw new Error(`Profile row missing for ${userId}: ${profileError?.message ?? 'not found'}`);
  }

  if (profile.role !== 'educator') {
    throw new Error(
      `Profile ${userId} has role "${profile.role}", expected "educator". ` +
      `Check handle_new_user() and the role passed in user_metadata.`
    );
  }

  console.log(`  • Profile OK — ${profile.first_name} ${profile.last_name} (${profile.role}, ${profile.status})`);

  console.log('  • No teaching load needed — subject and grade access are chosen per upload.');

  console.log('\n  Done. Sign in with:');
  console.log(`    email:    ${DEMO.email}`);
  console.log(`    password: ${DEMO.password}`);
  console.log(`    id:       ${userId}\n`);
}

main().catch((err) => {
  console.error(`\n  Seed failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
