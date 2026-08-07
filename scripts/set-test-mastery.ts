/**
 * Forces a student's BKT mastery for one material, so Adaptive Test Mode can be
 * checked at each difficulty tier before the BKT engine exists.
 *
 *   npx tsx scripts/set-test-mastery.ts intermediate
 *   npx tsx scripts/set-test-mastery.ts advanced
 *   npx tsx scripts/set-test-mastery.ts foundational
 *   npx tsx scripts/set-test-mastery.ts 0.72              # any value 0-1
 *   npx tsx scripts/set-test-mastery.ts reset             # delete the rows
 *   npx tsx scripts/set-test-mastery.ts advanced "6."     # a different material
 *
 * WHY THIS EXISTS. The paper's Difficulty Alignment check (p. 98) is:
 * "confirms that the adaptive calibration pipeline correctly passes the mastery
 * parameter to the generative AI prompt." Until Phase 3 writes real mastery,
 * every concept sits at P(L₀) = 0.10 and every test is foundational — so the
 * only way to exercise the other two tiers is to put the numbers there by hand.
 *
 * ⚠️ THE TIER IS BAKED IN WHEN A TEST IS GENERATED. Changing mastery does not
 * re-tier a test that already exists. Generate a NEW test after running this.
 *
 * ⚠️ WRITES TO THE CONFIGURED SUPABASE PROJECT. This is a development tool for
 * verification runs, not something to leave lying in a live study.
 *
 * `reset` removes only the rows this script created for that student+material,
 * returning them to the P(L₀) default — which is the correct "no evidence yet"
 * state, not zero.
 */
import { supabaseAdmin } from '../server/lib/supabase';
import { masterySnapshot, masteryTier } from '../server/lib/testDifficulty';

/** Comfortably inside each band, away from the 0.50 / 0.85 boundaries. */
const TIER_VALUES: Record<string, number> = {
  foundational: 0.25,
  intermediate: 0.65,
  advanced: 0.92,
};

const [rawTarget, materialFragment = '7.'] = process.argv.slice(2);

function usage(message: string): never {
  console.error(`\n${message}\n`);
  console.error('Usage: npx tsx scripts/set-test-mastery.ts <foundational|intermediate|advanced|0-1|reset> [material]');
  process.exit(1);
}

async function main(): Promise<void> {
  if (!rawTarget) usage('Say which tier to set. There is no default, deliberately.');

  const target = rawTarget.toLowerCase();
  const isReset = target === 'reset';
  const value = isReset ? null : (TIER_VALUES[target] ?? Number(target));

  if (!isReset && (!Number.isFinite(value!) || value! < 0 || value! > 1)) {
    usage(`"${rawTarget}" is neither a tier name nor a number between 0 and 1.`);
  }

  // ── Student ───────────────────────────────────────────────────────────────
  const { data: students } = await supabaseAdmin
    .from('profiles')
    .select('id, first_name, last_name, grade_level')
    .eq('role', 'student')
    .eq('status', 'active');

  if (!students?.length) usage('No active student account found.');
  if (students.length > 1) {
    console.error('\nMore than one active student — this script needs exactly one:');
    for (const s of students) console.error(`  ${s.id}  ${s.first_name} ${s.last_name}`);
    process.exit(1);
  }
  const student = students[0];

  // ── Material ──────────────────────────────────────────────────────────────
  const { data: materials } = await supabaseAdmin
    .from('materials')
    .select('id, title')
    .ilike('title', `%${materialFragment}%`);

  if (!materials?.length) usage(`No material matching "${materialFragment}".`);
  if (materials.length > 1) {
    console.error(`\n"${materialFragment}" matches more than one material:`);
    for (const m of materials) console.error(`  ${m.title}`);
    process.exit(1);
  }
  const material = materials[0];

  const { data: concepts } = await supabaseAdmin
    .from('concepts')
    .select('id')
    .eq('material_id', material.id);

  const conceptIds = (concepts ?? []).map((c) => c.id as string);
  if (conceptIds.length === 0) usage(`"${material.title}" has no concepts.`);

  console.log(`\nStudent : ${student.first_name} ${student.last_name} (grade ${student.grade_level})`);
  console.log(`Material: ${material.title} — ${conceptIds.length} concepts`);

  // ── Write ─────────────────────────────────────────────────────────────────
  if (isReset) {
    const { error } = await supabaseAdmin
      .from('bkt_mastery')
      .delete()
      .eq('student_id', student.id)
      .in('concept_id', conceptIds);
    if (error) throw new Error(`delete failed: ${error.message}`);
    console.log(`Action  : removed mastery rows — concepts fall back to P(L0) = 0.10`);
  } else {
    const { error } = await supabaseAdmin.from('bkt_mastery').upsert(
      conceptIds.map((concept_id) => ({
        student_id: student.id,
        concept_id,
        latent_mastery: value,
        opportunity_count: 0,
      })),
      { onConflict: 'student_id,concept_id' }
    );
    if (error) throw new Error(`upsert failed: ${error.message}`);
    console.log(`Action  : set every concept to ${value}`);
  }

  // ── Verify by reading it back the way the route does ──────────────────────
  const { snapshot } = await masterySnapshot(student.id, conceptIds);
  const tier = masteryTier(snapshot);

  console.log(`\nRead back through the same code the generator uses:`);
  console.log(`  mastery_snapshot : ${snapshot}`);
  console.log(`  difficulty_tier  : ${tier.toUpperCase()}`);
  console.log(`\nNow generate a NEW test on "${material.title}" in Test Mode.`);
  console.log('Tests that already exist keep the tier they were built with.\n');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
