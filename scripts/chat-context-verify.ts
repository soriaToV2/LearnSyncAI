/**
 * Verifies the chatbot's context decision (server/lib/chatContext.ts) against a real lesson.
 * Run: `npx tsx scripts/chat-context-verify.ts [--answers]`
 *
 * Covers follow-ups ("can you re-explain in English?" was refused because only the newest message
 * was gated), Filipino/Taglish requests, and the off-topic guard in both languages. Calls the real
 * resolveChatContext(), so the thresholds, regexes and match_concepts are tested together.
 *
 * Read-only: embedding calls plus match_concepts; no sign-in, no chatbot_logs rows.
 * --answers also streams the real chat model's reply for the follow-up cases (~6 flash-lite calls),
 * printed for a human to read: any reply that answers the unrelated topic is a failure.
 */
import { supabaseAdmin } from '../server/lib/supabase';
import { ThinkingLevel } from '@google/genai';
import { streamContent, GEMINI_CHAT_MODEL } from '../server/lib/gemini';
import {
  resolveChatContext,
  buildChatSystemPrompt,
  type ChatTurn,
  type ChatContextDecision,
} from '../server/lib/chatContext';

/** "First quarter lessons (g9)", Grade 9 Science, the lesson the defense demo uses. */
const MATERIAL_ID = '5ea92661-8b6c-4c22-8d5b-d9fcb5eed433';

const WITH_ANSWERS = process.argv.includes('--answers');

const TAGLISH_SUMMARY =
  'what is this lesson all about? magbigay ka nga ng summary kung ano ano ang mga lessons dito and make sure to explain it in very simple terms. can you explain it in tagalog?';

const QUIZ_PROMPT =
  'Ask me 5 challenging questions to test my understanding of the key concepts in my selected materials. After I answer each one, give me feedback.';

interface Case {
  label: string;
  message: string;
  history?: ChatTurn[];
  mode?: 'rag' | 'full';
  /** Acceptable kinds; null = report only (decided by the model's reply under --answers). */
  expect: ChatContextDecision['kind'][] | null;
  expectFollowUp?: boolean;
  /** Stream the model's reply under --answers. */
  answer?: boolean;
}

const user = (content: string): ChatTurn => ({ role: 'user', content });
const assistant = (content: string): ChatTurn => ({ role: 'assistant', content });

const CASES: Case[] = [
  // English, unchanged behaviour
  { label: 'specific question', message: 'What is inertia?', expect: ['rag'], expectFollowUp: false },
  { label: 'summary request', message: 'Summarize this lesson', expect: ['full'], expectFollowUp: false },
  { label: 'off-topic', message: 'Who won the NBA finals?', expect: ['refuse'] },
  { label: 'off-topic summary look-alike', message: 'Summarize the Avengers movie', expect: ['refuse'] },

  // Follow-ups
  {
    label: 'logged pair: Taglish summary → "can you reexplain in english?"',
    message: 'can you reexplain in english?',
    history: [user(TAGLISH_SUMMARY), assistant('Ang iyong mga aralin ay tungkol sa mga puwersa, kuryente at mga alon…')],
    expect: ['full'],
    expectFollowUp: true,
    answer: true,
  },
  {
    label: 'specific question → "give me an example"',
    message: 'give me an example',
    history: [user('What is inertia?'), assistant('Inertia is the tendency of an object to resist changes in its motion.')],
    expect: ['rag', 'full'],
    expectFollowUp: true,
    answer: true,
  },
  {
    label: 'Tagalog follow-up: summary → "pakipaliwanag ulit sa English"',
    message: 'pakipaliwanag ulit sa English',
    history: [user('Ano ang buod ng aralin na ito?'), assistant('Ang aralin ay tungkol sa puwersa, kuryente at mga alon…')],
    expect: ['full'],
    expectFollowUp: true,
    answer: true,
  },
  {
    label: 'Quiz Me → answer "B" to question 2',
    message: 'B',
    history: [
      user(QUIZ_PROMPT),
      assistant('Question 1: What is inertia? A) resistance to change in motion B) a push or pull. Question 2: Which wave needs a medium? A) electromagnetic B) mechanical.'),
      user('A'),
      assistant('Correct! Inertia is resistance to a change in motion. Now question 2.'),
    ],
    expect: ['full', 'rag'],
    expectFollowUp: true,
    answer: true,
  },
  {
    label: 'Quiz Me → wrong answer "the current increases" (must be corrected)',
    message: 'the current increases',
    history: [
      user(QUIZ_PROMPT),
      assistant('Question 2: If you have an electric circuit with a constant voltage, what happens to the current if you increase the resistance? Think about Ohm\'s law (V = IR).'),
    ],
    expect: ['full'],
    expectFollowUp: false,
    answer: true,
  },
  { label: 'follow-up with no history', message: 'can you reexplain in english?', expect: ['refuse'] },
  {
    label: 'off-topic → "can you say that in English?"',
    message: 'can you say that in English?',
    history: [user('Who won the NBA finals?'), assistant("I couldn't find anything in your selected materials related to that question.")],
    expect: ['refuse'],
  },
  // Pre-existing: "explain it" is a whole-lesson pattern on its own, so this gets the lesson; the
  // reply must explain the lesson, never the NBA.
  {
    label: 'off-topic → "explain it again" (whole-lesson pattern)',
    message: 'explain it again',
    history: [user('Who won the NBA finals?'), assistant("I couldn't find anything in your selected materials related to that question.")],
    expect: null,
    answer: true,
  },

  // Filipino / Taglish
  { label: 'Tagalog specific', message: 'Ano ang inertia?', expect: ['rag'], expectFollowUp: false },
  { label: 'Tagalog specific 2', message: "Ipaliwanag mo ang Ohm's law", expect: ['rag'], expectFollowUp: false },
  { label: 'Taglish specific', message: "Pwede mo bang i-explain ang Newton's third law?", expect: ['rag'], expectFollowUp: false },
  { label: 'Tagalog summary (buod)', message: 'Ano ang buod ng aralin na ito?', expect: ['full'], expectFollowUp: false },
  { label: 'Tagalog "what is it about"', message: 'Tungkol saan ang aralin na ito?', expect: ['full'], expectFollowUp: false },
  { label: 'Tagalog main concepts', message: 'Ano ang mga pangunahing konsepto ng aralin?', expect: ['full'], expectFollowUp: false },
  { label: 'Tagalog off-topic', message: 'Sino ang nanalo sa NBA finals?', expect: ['refuse'] },
  // Each Filipino whole-lesson pattern needs its off-topic look-alike below 0.51, or it is dropped.
  { label: 'Tagalog off-topic look-alike (buod)', message: 'Ano ang buod ng pelikulang Avengers?', expect: ['refuse'] },
  { label: 'Tagalog off-topic look-alike (tungkol saan)', message: 'Tungkol saan ang pelikulang Avengers?', expect: ['refuse'] },
  { label: 'Tagalog off-topic look-alike (pangunahing konsepto)', message: 'Ano ang mga pangunahing konsepto ng basketball?', expect: ['refuse'] },
  { label: 'Tagalog off-topic request', message: 'Gumawa ka ng tula tungkol sa pag-ibig', expect: ['refuse'] },

  // Unrelated follow-up after an on-topic question: passes the gate; the prompt must decline it.
  {
    label: 'on-topic → "now tell me about Taylor Swift"',
    message: 'now tell me about Taylor Swift',
    history: [user('What is inertia?'), assistant('Inertia is the tendency of an object to resist changes in its motion.')],
    expect: null,
    answer: true,
  },
  {
    label: 'on-topic → Tagalog "Taylor Swift"',
    message: 'Ngayon, ikuwento mo naman sa akin si Taylor Swift',
    history: [user('Ano ang inertia?'), assistant('Ang inertia ay ang ugali ng isang bagay na labanan ang pagbabago sa galaw nito.')],
    expect: null,
    answer: true,
  },
];

let failures = 0;

async function replyFor(c: Case, decision: ChatContextDecision): Promise<string> {
  const stream = await streamContent({
    model: GEMINI_CHAT_MODEL,
    systemInstruction: buildChatSystemPrompt(decision.concepts, { followUp: decision.followUp }),
    history: c.history ?? [],
    message: c.message,
    thinkingLevel: ThinkingLevel.MINIMAL,
    maxOutputTokens: 4096,
  });
  let text = '';
  for await (const token of stream) text += token;
  return text;
}

async function main(): Promise<void> {
  const { count } = await supabaseAdmin
    .from('concepts')
    .select('id', { count: 'exact', head: true })
    .eq('material_id', MATERIAL_ID);
  console.log(`Lesson ${MATERIAL_ID}: ${count} concepts${WITH_ANSWERS ? ' · with model replies' : ''}\n`);

  for (const c of CASES) {
    const decision = await resolveChatContext({
      message: c.message,
      history: c.history ?? [],
      materialIds: [MATERIAL_ID],
      mode: c.mode ?? 'rag',
    });

    const sims =
      `topSim=${decision.topSim.toFixed(3)}` +
      (decision.followUpTopSim !== null ? ` followUpTopSim=${decision.followUpTopSim.toFixed(3)}` : '');
    const got = `${decision.kind}${decision.followUp ? ' (follow-up)' : ''}, ${decision.concepts.length} concepts`;

    let ok = true;
    if (c.expect !== null && !c.expect.includes(decision.kind)) ok = false;
    if (c.expectFollowUp !== undefined && decision.kind !== 'refuse' && decision.followUp !== c.expectFollowUp) ok = false;
    if (!ok) failures++;

    const tag = c.expect === null ? 'INFO' : ok ? 'PASS' : 'FAIL';
    console.log(`   ${tag}  ${c.label}`);
    console.log(`         → ${got} · ${sims}${c.expect !== null && !ok ? ` · expected ${c.expect.join('/')}` : ''}`);

    if (WITH_ANSWERS && c.answer && decision.kind !== 'refuse') {
      const reply = (await replyFor(c, decision)).trim();
      const shown = c.expect === null || reply.length <= 700 ? reply : `${reply.slice(0, 700)}…`;
      console.log(`         REPLY (read it): ${shown.replace(/\n+/g, '\n         ')}`);
    }
    console.log('');
  }

  console.log(failures === 0 ? 'All decision checks passed.' : `${failures} decision check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
