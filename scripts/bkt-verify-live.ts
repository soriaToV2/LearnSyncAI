/**
 * The `--live` half of the ICR harness. Not run directly — see `bkt-verify.ts`.
 *
 * Paper p. 96: "Each test case is executed in the live application, and the
 * system-generated mastery value is compared against the manually computed
 * expected value." The offline sections prove the arithmetic; this proves the
 * arithmetic is actually WIRED to the two buttons a student presses. Offline
 * checks could all pass while the engine is never called — which is exactly the
 * class of defect that hid in the telemetry insert for months.
 *
 * ── IT BUILDS ITS OWN STUDENT, THEN DELETES THEM ─────────────────────────────
 *
 * Rather than borrowing a real account, the run creates a throwaway student with
 * a study space, a deck and four flashcards pointing at real concepts, exercises
 * the endpoints, prints its evidence, and removes the account in a `finally`.
 * Everything else cascades from `profiles.id`, so nothing is left behind and the
 * harness is safely re-runnable. Pass `--keep` to leave the account for
 * inspection.
 *
 * That also means it signs in with a password it set itself, and sends a normal
 * Bearer token — so the run traverses `authenticate` and `requireRole('student')`
 * exactly as the browser does. It deliberately does NOT mint a service-role JWT,
 * which would skip the middleware this is meant to exercise.
 *
 * ── WHY IT FORCES THE PRIOR ──────────────────────────────────────────────────
 *
 * A live posterior depends on live state, so a run that just reads back whatever
 * the server produced can only show the row is self-consistent. That is an
 * INTEGRATION claim wearing a correctness claim's clothes. A fresh student has no
 * `bkt_mastery` rows at all, which is both the true cold start and a test of the
 * "missing row means 0.10, not 0" rule — so the expected posterior is the same
 * hand-computed literal the offline sections use.
 *
 * ⚠️ `--live-test` burns one of the ~11 daily Groq test generations the whole
 * account has.
 */

import { supabaseAdmin, supabaseAnon } from '../server/lib/supabase';
import { bktStep, loadBktParameters } from '../server/lib/bkt';
import { QUESTION_FORMATS } from '../server/types/api';

const BASE_URL = process.env.BKT_VERIFY_BASE_URL ?? 'http://localhost:5000/api';
const S = 0.15;
const T = 0.2;

/** From P(L₀) = 0.10 — the same literals §2 of the offline harness checks. */
const EXPECTED_FROM_PRIOR: Record<string, { posterior: number; evidence: number; obs: 0 | 1; pGuess: number }> = {
  easy: { posterior: 0.7231, evidence: 0.6538, obs: 1, pGuess: 0.05 },
  medium: { posterior: 0.4194, evidence: 0.2742, obs: 1, pGuess: 0.25 },
  hard: { posterior: 0.2145, evidence: 0.0182, obs: 0, pGuess: 0.1 },
};

type Begin = (id: string, title: string, provenance: string) => void;
type Check = (label: string, actual: number, expected: number, work?: string) => boolean;
type CheckExact = (label: string, actual: unknown, expected: unknown) => boolean;

export interface LiveOptions {
  includeTest: boolean;
  keep: boolean;
  beginSection: Begin;
  check: Check;
  checkExact: CheckExact;
}

interface Fixture {
  studentId: string;
  token: string;
  spaceId: string;
  materialId: string;
  cards: { id: string; conceptId: string }[];
  conceptIds: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixture
// ─────────────────────────────────────────────────────────────────────────────

async function buildFixture(): Promise<Fixture> {
  const stamp = Date.now();
  const email = `bkt-verify-${stamp}@learnsync.invalid`;
  const password = `Verify!${stamp}aA`;

  // The material to work against: published, not archived, with the most concepts.
  const { data: materials } = await supabaseAdmin
    .from('materials')
    .select('id, title, subject, grade_levels')
    .eq('is_archived', false);

  const candidates = (materials ?? []).filter(
    (m) => Array.isArray(m.grade_levels) && (m.grade_levels as number[]).length > 0
  );
  if (candidates.length === 0) throw new Error('No published material to verify against.');

  const material = candidates[candidates.length - 1];
  const gradeLevel = (material.grade_levels as number[])[0];

  const { data: concepts } = await supabaseAdmin
    .from('concepts')
    .select('id, term, definition')
    .eq('material_id', material.id)
    .order('created_at');

  if (!concepts || concepts.length < 4) {
    throw new Error(`"${material.title}" has ${concepts?.length ?? 0} concepts; need at least 4.`);
  }

  // `handle_new_user` reads role and grade straight out of the metadata, so the
  // profile lands correct with no follow-up update.
  const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      role: 'student',
      grade_level: String(gradeLevel),
      first_name: 'BKT',
      last_name: 'Verify',
    },
  });
  if (createError || !created.user) throw new Error(`Could not create the throwaway student: ${createError?.message}`);
  const studentId = created.user.id;

  try {
    const { data: space, error: spaceError } = await supabaseAdmin
      .from('study_spaces')
      .insert({ student_id: studentId, title: 'BKT verification', subject: material.subject })
      .select('id')
      .single();
    if (spaceError || !space) throw new Error(`study_spaces insert failed: ${spaceError?.message}`);

    await supabaseAdmin
      .from('study_space_materials')
      .insert({ space_id: space.id, material_id: material.id });

    const { data: deck, error: deckError } = await supabaseAdmin
      .from('flashcard_decks')
      .insert({ space_id: space.id, title: 'BKT verification deck' })
      .select('id')
      .single();
    if (deckError || !deck) throw new Error(`flashcard_decks insert failed: ${deckError?.message}`);

    // Four cards on four distinct concepts: three ratings plus the not-due case.
    const chosen = concepts.slice(0, 4);
    const { data: cards, error: cardError } = await supabaseAdmin
      .from('flashcards')
      .insert(
        chosen.map((c) => ({
          deck_id: deck.id,
          concept_id: c.id,
          source_material_id: material.id,
          term: c.term,
          definition: c.definition,
        }))
      )
      .select('id, concept_id');
    if (cardError || !cards) throw new Error(`flashcards insert failed: ${cardError?.message}`);

    const { data: session, error: signInError } = await supabaseAnon.auth.signInWithPassword({
      email,
      password,
    });
    if (signInError || !session.session) throw new Error(`Sign-in failed: ${signInError?.message}`);

    console.log(`\n  Fixture: throwaway student ${studentId}`);
    console.log(`           material "${material.title}" (${concepts.length} concepts, grade ${gradeLevel})`);

    return {
      studentId,
      token: session.session.access_token,
      spaceId: space.id as string,
      materialId: material.id as string,
      cards: (cards ?? []).map((c) => ({ id: c.id as string, conceptId: c.concept_id as string })),
      conceptIds: concepts.map((c) => c.id as string),
    };
  } catch (err) {
    await supabaseAdmin.auth.admin.deleteUser(studentId).catch(() => undefined);
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP + reads
// ─────────────────────────────────────────────────────────────────────────────

async function call<T>(
  token: string,
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown
): Promise<{ status: number; data: T | null; message?: string }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: { data?: T; message?: string; error?: string } = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    /* a non-JSON body is itself the failure; the status carries it */
  }
  return { status: res.status, data: parsed.data ?? null, message: parsed.message ?? parsed.error };
}

async function latestLog(studentId: string, conceptId: string) {
  const { data } = await supabaseAdmin
    .from('bkt_update_logs')
    .select('*')
    .eq('student_id', studentId)
    .eq('concept_id', conceptId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

async function masteryOf(studentId: string, conceptId: string) {
  const { data } = await supabaseAdmin
    .from('bkt_mastery')
    .select('latent_mastery, opportunity_count')
    .eq('student_id', studentId)
    .eq('concept_id', conceptId)
    .maybeSingle();
  return data;
}

// ─────────────────────────────────────────────────────────────────────────────
// §6 — Flashcards
// ─────────────────────────────────────────────────────────────────────────────

async function flashcardLeg(o: LiveOptions, fx: Fixture): Promise<void> {
  o.beginSection(
    '§6',
    'Live application — POST /api/flashcards/rate',
    'the same hand-computed literals as §2; the student is new, so every prior is a true cold-start P(L0) = 0.10'
  );

  const past = new Date(Date.now() - 86_400_000).toISOString();
  const ratings: ('easy' | 'medium' | 'hard')[] = ['easy', 'medium', 'hard'];

  console.log('');
  for (let i = 0; i < ratings.length; i++) {
    const rating = ratings[i];
    const card = fx.cards[i];
    const want = EXPECTED_FROM_PRIOR[rating];

    await supabaseAdmin.from('flashcards').update({ next_review_at: past }).eq('id', card.id);

    const res = await call<{ counted: boolean }>(fx.token, 'POST', '/flashcards/rate', {
      flashcard_id: card.id,
      rating,
    });

    o.checkExact(`rate "${rating}" → HTTP 200`, res.status, 200);
    o.checkExact(`rate "${rating}" → counted`, res.data?.counted, true);

    const row = await masteryOf(fx.studentId, card.conceptId);
    const log = await latestLog(fx.studentId, card.conceptId);

    o.check(
      `rate "${rating}" → bkt_mastery.latent_mastery`,
      Number(row?.latent_mastery),
      want.posterior,
      `prior 0.10, P(G)=${want.pGuess}, P(S)=0.15, P(T)=0.20 → hand-computed ${want.posterior}`
    );
    o.checkExact(`rate "${rating}" → opportunity_count incremented`, Number(row?.opportunity_count), 1);
    o.checkExact(`rate "${rating}" → log source`, log?.source, 'flashcard');
    o.checkExact(`rate "${rating}" → log rating recorded`, log?.rating, rating);
    o.checkExact(`rate "${rating}" → log question_type is NULL`, log?.question_type, null);
    o.checkExact(`rate "${rating}" → log observation`, Number(log?.observation), want.obs);
    o.check(`rate "${rating}" → log p_l_prior`, Number(log?.p_l_prior), 0.1);
    o.check(`rate "${rating}" → log p_guess`, Number(log?.p_guess), want.pGuess);
    o.check(`rate "${rating}" → log p_slip`, Number(log?.p_slip), S);
    o.check(`rate "${rating}" → log p_transit`, Number(log?.p_transit), T);
    o.check(`rate "${rating}" → log p_l_evidence  EQ(1)/(2)`, Number(log?.p_l_evidence), want.evidence);
    o.check(`rate "${rating}" → log p_l_posterior EQ(3)`, Number(log?.p_l_posterior), want.posterior);
    o.check(
      `rate "${rating}" → mastery equals the logged posterior`,
      Number(row?.latent_mastery),
      Number(log?.p_l_posterior)
    );
    console.log('');
  }

  // Direction checks, stated the way the paper's claims are stated.
  const easyM = Number((await masteryOf(fx.studentId, fx.cards[0].conceptId))?.latent_mastery);
  const mediumM = Number((await masteryOf(fx.studentId, fx.cards[1].conceptId))?.latent_mastery);
  const hardM = Number((await masteryOf(fx.studentId, fx.cards[2].conceptId))?.latent_mastery);
  o.checkExact('Easy raises mastery above the 0.10 prior', easyM > 0.1, true);
  o.checkExact('Easy raises it further than Medium', easyM > mediumM, true);
  o.checkExact('Hard is scored as an incorrect answer, below Medium', hardM < mediumM, true);

  /*
   * The due-check is the entire protection against farming mastery by
   * re-drilling one card, so it gets its own case.
   */
  console.log('');
  const notDue = fx.cards[3];
  await supabaseAdmin
    .from('flashcards')
    .update({ next_review_at: new Date(Date.now() + 86_400_000).toISOString() })
    .eq('id', notDue.id);

  const practice = await call<{ counted: boolean }>(fx.token, 'POST', '/flashcards/rate', {
    flashcard_id: notDue.id,
    rating: 'easy',
  });
  o.checkExact('not-due rating → counted is false', practice.data?.counted, false);
  o.checkExact('not-due rating → no bkt_mastery row written', await masteryOf(fx.studentId, notDue.conceptId), null);
  o.checkExact('not-due rating → no audit row written', await latestLog(fx.studentId, notDue.conceptId), null);

  // Re-rating an already-rated card: no longer due, so it must not count again.
  const redrill = await call<{ counted: boolean }>(fx.token, 'POST', '/flashcards/rate', {
    flashcard_id: fx.cards[0].id,
    rating: 'easy',
  });
  o.checkExact('re-drilling a just-rated card → counted is false', redrill.data?.counted, false);
  o.check(
    're-drilling leaves mastery unchanged',
    Number((await masteryOf(fx.studentId, fx.cards[0].conceptId))?.latent_mastery),
    EXPECTED_FROM_PRIOR.easy.posterior
  );
  o.checkExact(
    're-drilling adds no second opportunity',
    Number((await masteryOf(fx.studentId, fx.cards[0].conceptId))?.opportunity_count),
    1
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// §7 — A full adaptive test
// ─────────────────────────────────────────────────────────────────────────────

async function testLeg(o: LiveOptions, fx: Fixture): Promise<void> {
  o.beginSection(
    '§7',
    'Live application — a full adaptive test through PUT /api/practice/:id/complete',
    'every audit row re-derived from its OWN recorded prior and parameters'
  );

  /*
   * EQ(4) as it stands right now, computed here so the stored snapshot can be
   * checked against it.
   *
   * This is NOT 0.10, and that is the interesting part: §6 just rated three
   * flashcards on concepts belonging to this same material, so three of its
   * concepts carry real mastery and the rest are still at the prior. The
   * snapshot therefore doubles as evidence that flashcard ratings feed the test
   * generator's difficulty decision — the cross-feature path paper p. 81
   * describes, which no single-feature check can show.
   */
  const { data: priorRows } = await supabaseAdmin
    .from('bkt_mastery')
    .select('concept_id, latent_mastery')
    .eq('student_id', fx.studentId)
    .in('concept_id', fx.conceptIds);

  const known = new Map((priorRows ?? []).map((r) => [r.concept_id as string, Number(r.latent_mastery)]));
  const expectedSnapshot =
    fx.conceptIds.reduce((sum, id) => sum + (known.get(id) ?? 0.1), 0) / fx.conceptIds.length;

  console.log(
    `\n  ${known.size} of ${fx.conceptIds.length} concepts already have mastery (from §6); ` +
      `EQ(4) mean = ${expectedSnapshot.toFixed(4)}`
  );

  console.log('  Generating a test (burns one of ~11 daily Groq generations)…');
  const created = await call<{ id: string }>(fx.token, 'POST', '/practice', {
    space_id: fx.spaceId,
    material_id: fx.materialId,
    formats: [...QUESTION_FORMATS],
  });

  if (!created.data?.id) {
    console.log(`  SKIPPED — generation returned ${created.status}: ${created.message ?? 'no id'}`);
    return;
  }
  const testId = created.data.id;

  /*
   * The answer key is read from the row with the service role, because
   * `stripKey()` correctly refuses to put it on the wire — there is no other way
   * for a script to answer correctly. A deliberate dev-tool privilege the browser
   * never has, not a hole.
   */
  const { data: testRow } = await supabaseAdmin
    .from('practice_tests')
    .select('questions_payload, difficulty_tier, mastery_snapshot')
    .eq('id', testId)
    .single();

  const questions =
    ((testRow?.questions_payload as { questions?: Record<string, unknown>[] })?.questions ?? []) as {
      index: number;
      answer: string;
      options?: string[];
      format: string;
    }[];

  o.checkExact('test generated with questions', questions.length > 0, true);
  o.check(
    'stored mastery_snapshot equals EQ(4) over the material',
    Number(testRow?.mastery_snapshot),
    expectedSnapshot,
    `mean of ${known.size} assessed + ${fx.conceptIds.length - known.size} at P(L0)=0.10 → ${expectedSnapshot.toFixed(4)}` +
      '  — proves flashcard ratings reach the test generator'
  );
  o.checkExact(
    `snapshot ${expectedSnapshot.toFixed(4)} < 0.50 tiers as foundational`,
    testRow?.difficulty_tier,
    'foundational'
  );

  console.log(`\n  Answering ${questions.length} questions, alternating correct / incorrect…`);
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const wantCorrect = i % 2 === 0;
    let answer = q.answer;
    if (!wantCorrect) {
      const wrong = (q.options ?? []).find((opt) => opt !== q.answer);
      answer = wrong ?? `${q.answer} __deliberately wrong__`;
    }
    await call(fx.token, 'PUT', `/practice/${testId}/answer`, {
      question_index: q.index,
      answer,
      latency_ms: 1000,
    });
  }

  await call(fx.token, 'PUT', `/practice/${testId}/complete`, {});

  const { data: logs } = await supabaseAdmin
    .from('bkt_update_logs')
    .select('*')
    .eq('practice_test_id', testId)
    .order('created_at', { ascending: true });
  const { count: telemetryCount } = await supabaseAdmin
    .from('practice_telemetry')
    .select('*', { count: 'exact', head: true })
    .eq('practice_test_id', testId);

  console.log('');
  o.checkExact('audit rows were written', (logs?.length ?? 0) > 0, true);
  o.checkExact('one audit row per telemetry row', logs?.length ?? 0, telemetryCount ?? -1);

  const params = await loadBktParameters();
  let mismatches = 0;
  let ratingSet = 0;
  let wrongSlip = 0;
  for (const log of logs ?? []) {
    const redone = bktStep({
      prior: Number(log.p_l_prior),
      correct: Number(log.observation) === 1,
      pGuess: Number(log.p_guess),
      pSlip: Number(log.p_slip),
      pTransit: Number(log.p_transit),
    });
    if (Math.abs(redone.posterior - Number(log.p_l_posterior)) > 0.01) mismatches += 1;
    if (Math.abs(redone.evidence - Number(log.p_l_evidence)) > 0.01) mismatches += 1;
    if (log.rating !== null) ratingSet += 1;
    if (Number(log.p_slip) !== params.pS) wrongSlip += 1;
  }
  o.checkExact(`all ${logs?.length ?? 0} rows re-derive from their own recorded prior`, mismatches, 0);
  o.checkExact('no test row carries a flashcard rating', ratingSet, 0);
  o.checkExact('every row records the applied P(S)', wrongSlip, 0);

  /*
   * Per-format P(G) as it survived the round trip into the database.
   *
   * The expected values are LITERALS from paper pp. 73-75, not a lookup through
   * `GUESS_KEY_BY_FORMAT` — a wrong mapping would otherwise agree with itself on
   * both sides. Same rule as §2.
   */
  const PAPER_GUESS: Record<string, number> = {
    multiple_choice: 0.25,
    true_or_false: 0.5,
    identification: 0.05,
    fill_in_the_blank: 0.05,
    matching_type: 0.17,
  };

  const byFormat = new Map<string, Set<number>>();
  for (const log of logs ?? []) {
    const key = String(log.question_type);
    if (!byFormat.has(key)) byFormat.set(key, new Set());
    byFormat.get(key)!.add(Number(log.p_guess));
  }
  console.log('');
  for (const [format, guesses] of byFormat) {
    o.checkExact(
      `every ${format} row used P(G) = ${PAPER_GUESS[format]}`,
      [...guesses].join(','),
      String(PAPER_GUESS[format])
    );
  }

  // Mastery must equal the last posterior for each concept.
  let masteryMismatch = 0;
  const finals = new Map<string, number>();
  for (const log of logs ?? []) finals.set(log.concept_id as string, Number(log.p_l_posterior));
  for (const [conceptId, posterior] of finals) {
    const row = await masteryOf(fx.studentId, conceptId);
    if (Math.abs(Number(row?.latent_mastery) - posterior) > 0.01) masteryMismatch += 1;
  }
  console.log('');
  o.checkExact(`mastery matches the final posterior for all ${finals.size} concepts`, masteryMismatch, 0);

  // Idempotency — the reason the completion UPDATE is a compare-and-swap.
  const before = logs?.length ?? 0;
  await call(fx.token, 'PUT', `/practice/${testId}/complete`, {});
  const { count: afterLogs } = await supabaseAdmin
    .from('bkt_update_logs')
    .select('*', { count: 'exact', head: true })
    .eq('practice_test_id', testId);
  const { count: afterTelemetry } = await supabaseAdmin
    .from('practice_telemetry')
    .select('*', { count: 'exact', head: true })
    .eq('practice_test_id', testId);
  o.checkExact('re-completing writes no further audit rows', afterLogs ?? -1, before);
  o.checkExact('re-completing writes no further telemetry', afterTelemetry ?? -1, telemetryCount ?? -1);

  // Where the material sits now. The tier is chosen at generation, so this is
  // what the student's NEXT test would be calibrated against.
  const { data: after } = await supabaseAdmin
    .from('bkt_mastery')
    .select('concept_id, latent_mastery')
    .eq('student_id', fx.studentId)
    .in('concept_id', fx.conceptIds);
  const nowKnown = new Map((after ?? []).map((r) => [r.concept_id as string, Number(r.latent_mastery)]));
  const mean = fx.conceptIds.reduce((sum, id) => sum + (nowKnown.get(id) ?? 0.1), 0) / fx.conceptIds.length;
  console.log(
    `\n  EQ(4) after the test: ${mean.toFixed(4)} across ${fx.conceptIds.length} concepts ` +
      `(was ${expectedSnapshot.toFixed(4)}). A next test would tier as ` +
      `${mean >= 0.85 ? 'advanced' : mean >= 0.5 ? 'intermediate' : 'foundational'}.`
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export async function runLiveVerification(o: LiveOptions): Promise<void> {
  const health = await fetch(`${BASE_URL}/health`).catch(() => null);
  if (!health || !health.ok) {
    throw new Error(`No API server at ${BASE_URL}. Start it with \`npm run dev:server\` and re-run.`);
  }

  const fx = await buildFixture();
  try {
    await flashcardLeg(o, fx);
    if (o.includeTest) {
      await testLeg(o, fx);
    } else {
      console.log('\n  (adaptive test leg skipped — pass --live-test to include it)');
    }
  } finally {
    if (o.keep) {
      console.log(`\n  --keep: throwaway student ${fx.studentId} left in place for inspection.`);
    } else {
      const { error } = await supabaseAdmin.auth.admin.deleteUser(fx.studentId);
      console.log(
        error
          ? `\n  ⚠️  Could not delete the throwaway student ${fx.studentId}: ${error.message}`
          : `\n  Cleaned up: throwaway student deleted, all its rows cascaded. Nothing left behind.`
      );
    }
  }
}
