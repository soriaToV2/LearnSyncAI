/**
 * Verifies that test answers saved at the same moment all survive (QA defect D21-race).
 * Run: `STUDENT_USERNAME=… STUDENT_PASSWORD=… npx tsx scripts/test-answer-race-verify.ts`
 * against a running API (TEST_RACE_BASE_URL, default http://localhost:5000/api).
 *
 * A matching block is one screen with four answers, and the client used to save them with
 * Promise.all; PUT /:id/answer read-modified-wrote the whole student_answers JSONB, so the last
 * writer won and the others were graded as unanswered. This fires exactly that burst at the real
 * route, three times, and counts what was kept.
 *
 * Writes: one throwaway in_progress practice_tests row in the student's space, deleted in `finally`.
 * No model call, no telemetry, no mastery.
 */
import { supabaseAdmin } from '../server/lib/supabase';

const BASE_URL = process.env.TEST_RACE_BASE_URL ?? 'http://localhost:5000/api';
const USERNAME = process.env.STUDENT_USERNAME;
const PASSWORD = process.env.STUDENT_PASSWORD;
const TRIALS = 3;
const ANSWERS_PER_TRIAL = 4;

let failures = 0;

function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  console.log(`         ${detail}`);
}

async function login(): Promise<{ token: string; studentId: string }> {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
  const body = (await res.json()) as { data?: { session?: { access_token: string; user: { id: string } } } };
  const session = body.data?.session;
  if (!res.ok || !session) throw new Error(`Sign-in failed (HTTP ${res.status})`);
  return { token: session.access_token, studentId: session.user.id };
}

function matchingQuestion(index: number, blockId: string) {
  return {
    index,
    blockId,
    format: 'matching_type',
    concept_id: '00000000-0000-4000-8000-000000000000',
    concept_term: `race term ${index}`,
    difficulty: 'foundational',
    prompt: `race term ${index}`,
    options: Array.from({ length: 6 }, (_, i) => `definition ${i}`),
    answer: `definition ${index % 6}`,
    explanation: 'throwaway',
  };
}

async function saveAnswer(token: string, testId: string, index: number, answer: string, latencyMs: number) {
  const res = await fetch(`${BASE_URL}/practice/${testId}/answer`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ question_index: index, answer, latency_ms: latencyMs }),
  });
  return res.status;
}

async function storedAnswers(testId: string): Promise<Record<string, { answer: string; latency_ms: number }>> {
  const { data, error } = await supabaseAdmin.from('practice_tests').select('student_answers').eq('id', testId).single();
  if (error) throw new Error(error.message);
  return (data?.student_answers ?? {}) as Record<string, { answer: string; latency_ms: number }>;
}

async function main(): Promise<void> {
  if (!USERNAME || !PASSWORD) throw new Error('Set STUDENT_USERNAME and STUDENT_PASSWORD.');
  const { token, studentId } = await login();

  const { data: space } = await supabaseAdmin
    .from('study_spaces').select('id').eq('student_id', studentId).limit(1).maybeSingle();
  if (!space) throw new Error('That student has no study space to hold the throwaway test.');

  const questions = Array.from({ length: TRIALS * ANSWERS_PER_TRIAL }, (_, i) =>
    matchingQuestion(i, `block-${Math.floor(i / ANSWERS_PER_TRIAL)}`)
  );
  const { data: test, error } = await supabaseAdmin
    .from('practice_tests')
    .insert({
      space_id: space.id,
      student_id: studentId,
      title: 'RACE VERIFY (throwaway)',
      source_material_ids: [],
      question_types: ['matching_type'],
      questions_payload: { version: 1, questions },
      student_answers: {},
      difficulty_tier: 'foundational',
      status: 'in_progress',
    })
    .select('id')
    .single();
  if (error || !test) throw new Error(`Could not create the throwaway test: ${error?.message}`);

  try {
    console.log(`Throwaway test ${test.id} · ${TRIALS} trials of ${ANSWERS_PER_TRIAL} simultaneous saves\n`);

    for (let t = 0; t < TRIALS; t++) {
      const indices = Array.from({ length: ANSWERS_PER_TRIAL }, (_, i) => t * ANSWERS_PER_TRIAL + i);
      const statuses = await Promise.all(indices.map(i => saveAnswer(token, test.id, i, `definition ${i % 6}`, 1000)));
      const stored = await storedAnswers(test.id);
      const kept = indices.filter(i => stored[String(i)]?.answer === `definition ${i % 6}`);
      check(
        `trial ${t + 1}: ${ANSWERS_PER_TRIAL} answers saved at once are all kept`,
        kept.length === ANSWERS_PER_TRIAL && statuses.every(s => s === 200),
        `HTTP ${statuses.join(',')} · kept ${kept.length} of ${ANSWERS_PER_TRIAL} (${kept.join(',') || 'none'})`
      );
    }

    // A second save of the same question adds its time, as before the fix.
    const status = await saveAnswer(token, test.id, 0, 'definition 5', 500);
    const stored = await storedAnswers(test.id);
    check(
      'a revised answer replaces the text and adds its time',
      status === 200 && stored['0']?.answer === 'definition 5' && stored['0']?.latency_ms === 1500,
      `HTTP ${status} · answer "${stored['0']?.answer}" · latency_ms ${stored['0']?.latency_ms} (expected 1500)`
    );
  } finally {
    const { error: delError } = await supabaseAdmin.from('practice_tests').delete().eq('id', test.id);
    console.log(delError ? `\nCLEANUP FAILED for ${test.id}: ${delError.message}` : '\nThrowaway test deleted.');
  }

  console.log(failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
