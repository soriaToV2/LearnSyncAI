/**
 * Sets one shared password across every imported student account and clears the first-login gate
 * (must_change_password), or the shared password would survive exactly one login.
 *
 *   npx tsx scripts/set-unified-password.ts "the-password"           # dry run, writes nothing
 *   npx tsx scripts/set-unified-password.ts "the-password" --apply   # performs it
 *
 * Requested by the principal for the usage week. It suspends the single-use property that makes the
 * memorable initial passwords acceptable: usernames are first.last, so any student can sign in as any
 * classmate and corrupt per-student mastery undetectably. Re-arm the gate when the window closes.
 *
 * The password is an argument and must never be hardcoded or committed.
 *
 * Writes to the configured Supabase project, the same one the deployed app uses. Dry-run first.
 */
import { supabaseAdmin } from '../server/lib/supabase';
import { ResetAccountPasswordSchema } from '../server/types/api';

/** Sample accounts from default_users.csv that keep their own password and activation state. Literals, so the exclusion can be audited. */
const EXCLUDED_IDS = [
  '0c4ea02a-1711-4ca6-95f5-ee22123a0630', // student      — Jhon Osa
  '1e20c99b-96fa-4581-930f-19f30bb49ae3', // educ1        — Luffy Kamado (educator)
  '57f9268d-265e-452a-b7dc-3c68771264f5', // apok.tinola  — Apok Tinola
  '6a51f767-c638-4d4d-be2c-bbe0570ddf6d', // admin        — Demo Admin
  '97d56a57-bcae-4d00-8c75-1d34cb57d51d', // test.test    — test test
  'bb779070-c131-442a-bf8a-07870feebdad', // angelo.soria — Angelo Soria
  'd906cc43-793e-4e47-af9a-cd6412e4e107', // louis        — Louis Baruelo
];

interface Student {
  id: string;
  username: string | null;
  first_name: string;
  last_name: string;
  grade_level: number | null;
}

function fail(message: string): never {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

async function loadStudents(): Promise<Student[]> {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, username, first_name, last_name, grade_level')
    .eq('role', 'student')
    // PostgREST wants the exclusion list as a parenthesised set.
    .not('id', 'in', `(${EXCLUDED_IDS.join(',')})`)
    .order('grade_level', { ascending: true })
    .order('last_name', { ascending: true });

  if (error) fail(`Could not read the student list: ${error.message}`);
  return (data ?? []) as Student[];
}

function report(students: Student[]): void {
  const byGrade = new Map<number | null, number>();
  for (const s of students) byGrade.set(s.grade_level, (byGrade.get(s.grade_level) ?? 0) + 1);

  console.log(`\n${students.length} student accounts in scope:\n`);
  for (const s of students) {
    const grade = s.grade_level === null ? '—' : `G${s.grade_level}`;
    console.log(
      `  ${grade.padEnd(4)} ${(s.username ?? '(no username)').padEnd(28)} ${s.first_name} ${s.last_name}`
    );
  }

  console.log('\n  by grade:');
  for (const [grade, count] of [...byGrade].sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0))) {
    console.log(`    ${grade === null ? 'none' : `Grade ${grade}`}: ${count}`);
  }
  console.log(`\n  excluded (untouched): ${EXCLUDED_IDS.length} sample accounts`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const password = args.find((a) => a !== '--apply');

  if (!password) {
    fail(
      'Give the password as the first argument:\n' +
        '    npx tsx scripts/set-unified-password.ts "the-password"\n' +
        '    npx tsx scripts/set-unified-password.ts "the-password" --apply'
    );
  }

  /* Validated with the admin reset route's schema, so the app can't reject a password set here. */
  const check = ResetAccountPasswordSchema.safeParse({ new_password: password });
  if (!check.success) {
    fail(
      `That password does not meet the rule every other password path enforces:\n    ` +
        check.error.issues.map((i) => i.message).join('\n    ')
    );
  }

  const students = await loadStudents();
  if (students.length === 0) fail('No student accounts matched. Nothing to do.');

  report(students);

  if (!apply) {
    console.log('\nDry run — nothing was written. Re-run with --apply to perform it.\n');
    return;
  }

  console.log(`\nApplying to ${students.length} accounts (sequentially)...\n`);

  const succeeded: string[] = [];
  const failed: { username: string; reason: string }[] = [];

  /* Sequential, never Promise.all: Supabase rate-limits the auth admin API by source IP. */
  for (const student of students) {
    const label = student.username ?? student.id;
    const { error } = await supabaseAdmin.auth.admin.updateUserById(student.id, {
      password,
    });

    if (error) {
      failed.push({ username: label, reason: error.message });
      console.log(`  ✖ ${label} — ${error.message}`);
    } else {
      succeeded.push(student.id);
      console.log(`  ✔ ${label}`);
    }
  }

  /* Password first, flag second: clearing the gate after a failed change would leave the old password open. */
  if (succeeded.length > 0) {
    const { error } = await supabaseAdmin
      .from('profiles')
      .update({ must_change_password: false })
      .in('id', succeeded);

    if (error) {
      fail(
        `Passwords were changed for ${succeeded.length} accounts, but clearing the ` +
          `activation gate FAILED: ${error.message}\n` +
          '  Those students can sign in with the shared password but will be asked to ' +
          'replace it. Re-run with --apply to retry the flag.'
      );
    }
  }

  console.log(`\n─────────────────────────────────────────────`);
  console.log(`  changed:   ${succeeded.length}`);
  console.log(`  failed:    ${failed.length}`);
  console.log(`  gate cleared on the ${succeeded.length} that succeeded`);
  if (failed.length > 0) {
    console.log('\n  retry these:');
    for (const f of failed) console.log(`    ${f.username} — ${f.reason}`);
  }
  console.log('');
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
