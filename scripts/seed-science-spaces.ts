/**
 * Creates the Science study space for every study student, pre-filled with the material published to
 * their grade, so nobody starts on an empty list.
 *
 *   npx tsx scripts/seed-science-spaces.ts           # dry run, writes nothing
 *   npx tsx scripts/seed-science-spaces.ts --apply   # performs it
 *
 * Reuses publishedMaterialIds(), the function POST /api/spaces calls, so a seeded space matches a
 * hand-made one; don't re-derive the rule here.
 *
 * study_spaces has no unique (student_id, subject), so the work is two idempotent halves
 * (create-if-missing, then link-if-missing). Re-running repairs a partial failure and pushes newly
 * uploaded materials instead of duplicating spaces.
 *
 * Writes to the configured Supabase project, the same one the deployed app uses. Dry-run first.
 * Batched writes are fine here: these are table writes, not the rate-limited auth admin API.
 */
import { supabaseAdmin } from '../server/lib/supabase';
import { publishedMaterialIds } from '../server/lib/materialAccess';

/** The subject to seed, and the title students will see on the tile. */
const SUBJECT = 'SCI';
const SPACE_TITLE = 'Science';

/** Test accounts to leave alone (they hold deliberate test state). Literals, so the exclusion can be audited by reading. */
const EXCLUDED_IDS = [
  '0c4ea02a-1711-4ca6-95f5-ee22123a0630', // student      — Jhon Osa
  '57f9268d-265e-452a-b7dc-3c68771264f5', // apok.tinola  — Apok Tinola
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
    .eq('status', 'active')
    // PostgREST wants the exclusion list as a parenthesised set.
    .not('id', 'in', `(${EXCLUDED_IDS.join(',')})`)
    .order('grade_level', { ascending: true })
    .order('last_name', { ascending: true });

  if (error) fail(`Could not read the student list: ${error.message}`);
  return (data ?? []) as Student[];
}

/** Existing SUBJECT spaces, student_id → space_id. Oldest wins if a student has two; the extra is reported. */
async function loadExistingSpaces(
  studentIds: string[]
): Promise<{ byStudent: Map<string, string>; duplicates: string[] }> {
  const { data, error } = await supabaseAdmin
    .from('study_spaces')
    .select('id, student_id, created_at')
    .eq('subject', SUBJECT)
    .in('student_id', studentIds)
    .order('created_at', { ascending: true });

  if (error) fail(`Could not read existing study spaces: ${error.message}`);

  const byStudent = new Map<string, string>();
  const duplicates: string[] = [];
  for (const row of data ?? []) {
    if (byStudent.has(row.student_id)) duplicates.push(row.student_id);
    else byStudent.set(row.student_id, row.id);
  }
  return { byStudent, duplicates };
}

/** Material ids published to each grade present in the cohort, fetched once per grade. */
async function loadMaterialsByGrade(grades: number[]): Promise<Map<number, string[]>> {
  const byGrade = new Map<number, string[]>();
  for (const grade of grades) {
    byGrade.set(grade, await publishedMaterialIds(SUBJECT, grade));
  }
  return byGrade;
}

/** Titles for the report only; linking works on ids. */
async function loadMaterialTitles(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data } = await supabaseAdmin.from('materials').select('id, title').in('id', ids);
  return new Map((data ?? []).map((row) => [row.id as string, row.title as string]));
}

/** Which (space, material) pairs are missing, given the spaces that exist now. */
async function missingLinks(
  spaceByStudent: Map<string, string>,
  students: Student[],
  materialsByGrade: Map<number, string[]>
): Promise<{ space_id: string; material_id: string }[]> {
  const spaceIds = [...spaceByStudent.values()];
  if (spaceIds.length === 0) return [];

  const { data, error } = await supabaseAdmin
    .from('study_space_materials')
    .select('space_id, material_id')
    .in('space_id', spaceIds);

  if (error) fail(`Could not read existing space materials: ${error.message}`);

  const linked = new Set((data ?? []).map((row) => `${row.space_id}:${row.material_id}`));

  const wanted: { space_id: string; material_id: string }[] = [];
  for (const student of students) {
    const spaceId = spaceByStudent.get(student.id);
    if (!spaceId || student.grade_level === null) continue;

    for (const materialId of materialsByGrade.get(student.grade_level) ?? []) {
      if (!linked.has(`${spaceId}:${materialId}`)) {
        wanted.push({ space_id: spaceId, material_id: materialId });
      }
    }
  }
  return wanted;
}

function report(
  students: Student[],
  spaceByStudent: Map<string, string>,
  materialsByGrade: Map<number, string[]>,
  titles: Map<string, string>,
  linksToAdd: number,
  duplicates: string[]
): void {
  const grades = [...new Set(students.map((s) => s.grade_level))].sort(
    (a, b) => (a ?? 0) - (b ?? 0)
  );

  console.log(`\n${students.length} student accounts in scope (subject ${SUBJECT}):\n`);
  console.log('  grade  students  have space  to create  material');
  console.log('  ─────  ────────  ──────────  ─────────  ────────');

  for (const grade of grades) {
    const inGrade = students.filter((s) => s.grade_level === grade);
    const have = inGrade.filter((s) => spaceByStudent.has(s.id)).length;
    const materials = grade === null ? [] : materialsByGrade.get(grade) ?? [];
    const names = materials.map((id) => titles.get(id) ?? id).join(', ') || '⚠ none published';

    console.log(
      `  ${(grade === null ? '—' : `G${grade}`).padEnd(5)}  ` +
        `${String(inGrade.length).padEnd(8)}  ${String(have).padEnd(10)}  ` +
        `${String(inGrade.length - have).padEnd(9)}  ${names}`
    );
  }

  const noGrade = students.filter((s) => s.grade_level === null);
  if (noGrade.length > 0) {
    console.log(`\n  ⚠ ${noGrade.length} student(s) have no grade level and will be SKIPPED:`);
    for (const s of noGrade) console.log(`      ${s.username ?? s.id} — ${s.first_name} ${s.last_name}`);
  }

  if (duplicates.length > 0) {
    console.log(
      `\n  ⚠ ${duplicates.length} student(s) already hold MORE THAN ONE ${SUBJECT} space.` +
        `\n    The earliest is used; the extras are left alone. Investigate before relying on this.`
    );
  }

  console.log(`\n  spaces to create:  ${students.length - spaceByStudent.size}`);
  console.log(`  links to add:      ${linksToAdd}`);
  console.log(`  excluded (untouched): ${EXCLUDED_IDS.length} test accounts`);
}

async function main(): Promise<void> {
  const apply = process.argv.slice(2).includes('--apply');

  const students = await loadStudents();
  if (students.length === 0) fail('No student accounts matched. Nothing to do.');

  const { byStudent: spaceByStudent, duplicates } = await loadExistingSpaces(
    students.map((s) => s.id)
  );

  const grades = [...new Set(students.map((s) => s.grade_level))].filter(
    (g): g is number => g !== null
  );
  const materialsByGrade = await loadMaterialsByGrade(grades);
  const titles = await loadMaterialTitles([...materialsByGrade.values()].flat());

  // Against the current spaces; the dry run below adds links for spaces not yet created.
  const pendingLinks = await missingLinks(spaceByStudent, students, materialsByGrade);
  const linksForNewSpaces = students
    .filter((s) => !spaceByStudent.has(s.id) && s.grade_level !== null)
    .reduce((n, s) => n + (materialsByGrade.get(s.grade_level!) ?? []).length, 0);

  report(
    students,
    spaceByStudent,
    materialsByGrade,
    titles,
    pendingLinks.length + linksForNewSpaces,
    duplicates
  );

  if (!apply) {
    console.log('\nDry run — nothing was written. Re-run with --apply to perform it.\n');
    return;
  }

  // 1. Create the missing spaces. A student who already has one keeps it, whatever it's called.
  const needSpace = students.filter((s) => !spaceByStudent.has(s.id) && s.grade_level !== null);

  if (needSpace.length > 0) {
    console.log(`\nCreating ${needSpace.length} spaces...`);
    const { data, error } = await supabaseAdmin
      .from('study_spaces')
      .insert(
        needSpace.map((s) => ({
          student_id: s.id,
          title: SPACE_TITLE,
          description: null,
          subject: SUBJECT,
        }))
      )
      .select('id, student_id');

    if (error) fail(`Space creation failed, nothing linked: ${error.message}`);
    for (const row of data ?? []) spaceByStudent.set(row.student_id as string, row.id as string);
    console.log(`  ✔ ${data?.length ?? 0} created`);
  } else {
    console.log('\nEvery student already has a space; nothing to create.');
  }

  // 2. Link missing materials, recomputed against the spaces as they now stand.
  const toLink = await missingLinks(spaceByStudent, students, materialsByGrade);

  if (toLink.length > 0) {
    console.log(`\nLinking ${toLink.length} materials...`);
    const { error } = await supabaseAdmin
      .from('study_space_materials')
      .upsert(toLink, { onConflict: 'space_id,material_id', ignoreDuplicates: true });

    if (error) {
      fail(
        `Spaces exist but linking FAILED: ${error.message}\n` +
          '  The spaces are safe. Re-run with --apply to retry only the links.'
      );
    }
    console.log(`  ✔ ${toLink.length} linked`);
  } else {
    console.log('\nEvery space already holds its materials; nothing to link.');
  }

  const skipped = students.filter((s) => s.grade_level === null).length;

  console.log(`\n─────────────────────────────────────────────`);
  console.log(`  students in scope: ${students.length}`);
  console.log(`  spaces created:    ${needSpace.length}`);
  console.log(`  materials linked:  ${toLink.length}`);
  if (skipped > 0) console.log(`  skipped (no grade): ${skipped}`);
  console.log('');
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
