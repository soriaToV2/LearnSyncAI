/*
 * ─────────────────────────────────────────────────────────────────────────────
 *  PHASE 2: DELETE THIS FILE.
 *
 *  Temporary stand-in for the Test Mode backend so Phase 1 can be clicked
 *  through end to end. It implements `TestApi` exactly, holds its own answer
 *  key, and grades the same way the server will.
 *
 *  Nothing outside `testMode.ts` may import this. When the real endpoints land,
 *  swap the one `testApi` line in `testMode.ts` and delete this file — no
 *  component changes.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type {
  GeneratedTest,
  GenerateTestRequest,
  MatchingQuestion,
  MissedConcept,
  QuestionFormat,
  QuestionResult,
  TestApi,
  TestQuestion,
  TestResult,
  TestSummary,
} from './testMode';
import {
  BLANK_TOKEN,
  MATCH_OPTIONS_PER_BLOCK,
  MATCH_TERMS_PER_BLOCK,
  allocateConcepts,
  orderedFormats,
} from './testMode';

// ─────────────────────────────────────────────────────────────────────────────
// A canned lesson, roughly the shape of a real `concepts` row
// ─────────────────────────────────────────────────────────────────────────────

interface CannedConcept {
  id: string;
  term: string;
  definition: string;
  /** A true statement, for true-or-false. */
  fact: string;
  /** A plausible but false statement about the same concept. */
  falseFact: string;
  /** A sentence containing BLANK_TOKEN whose missing word is the term. */
  blank: string;
}

const LESSON: CannedConcept[] = [
  {
    id: 'c-01',
    term: 'Firewall',
    definition:
      'A network security device or software that monitors incoming and outgoing traffic and decides whether to allow or block it based on a defined set of security rules.',
    fact: 'A firewall decides whether to allow or block traffic based on a defined set of security rules.',
    falseFact: 'A firewall removes viruses from files that are already stored on a computer.',
    blank: 'A ____ filters network traffic against a set of rules before it reaches the internal network.',
  },
  {
    id: 'c-02',
    term: 'Encryption',
    definition:
      'The process of converting readable data into an unreadable form so that only someone holding the correct key can restore and read the original content.',
    fact: 'Encryption converts readable data into a form only the holder of the correct key can restore.',
    falseFact: 'Encryption permanently destroys data so that it can never be recovered by anyone.',
    blank: 'Messages sent over HTTPS are protected by ____ so that intercepted traffic cannot be read.',
  },
  {
    id: 'c-03',
    term: 'Phishing',
    definition:
      'A social engineering attack in which the attacker impersonates a trusted party, usually by email or message, to trick a victim into revealing credentials or opening a malicious file.',
    fact: 'Phishing tricks a victim into revealing credentials by impersonating a trusted party.',
    falseFact: 'Phishing is a hardware fault that occurs when a network cable is damaged.',
    blank: 'An email pretending to come from your bank and asking you to confirm your password is an example of ____.',
  },
  {
    id: 'c-04',
    term: 'Malware',
    definition:
      'Any software written with the intent to damage, disrupt or gain unauthorised access to a computer system, including viruses, worms, ransomware and spyware.',
    fact: 'Ransomware and spyware are both categories of malware.',
    falseFact: 'Malware refers only to software that displays unwanted advertisements.',
    blank: 'Viruses, worms and ransomware are all forms of ____.',
  },
  {
    id: 'c-05',
    term: 'Two-Factor Authentication',
    definition:
      'A sign-in method that requires two different kinds of evidence before granting access, typically something the user knows such as a password and something the user has such as a phone.',
    fact: 'Two-factor authentication requires two different kinds of evidence before granting access.',
    falseFact: 'Two-factor authentication requires the user to enter the same password twice.',
    blank: 'Requiring both a password and a code sent to a phone is called ____.',
  },
  {
    id: 'c-06',
    term: 'Data Privacy Act of 2012',
    definition:
      'Republic Act 10173, the Philippine law that protects personal information held by government and private organisations and establishes the National Privacy Commission to enforce it.',
    fact: 'The Data Privacy Act of 2012 established the National Privacy Commission.',
    falseFact: 'The Data Privacy Act of 2012 is Republic Act 10175 and covers cybercrime offences.',
    blank: 'Republic Act 10173 is more commonly known as the ____.',
  },
  {
    id: 'c-07',
    term: 'Cybercrime Prevention Act',
    definition:
      'Republic Act 10175, the Philippine law that defines and penalises offences committed through computer systems, including illegal access, data interference and computer-related fraud.',
    fact: 'The Cybercrime Prevention Act penalises illegal access and computer-related fraud.',
    falseFact: 'The Cybercrime Prevention Act is the law that created the National Privacy Commission.',
    blank: 'Illegal access and data interference are penalised under the ____.',
  },
  {
    id: 'c-08',
    term: 'Incident Response',
    definition:
      'The organised process an organisation follows to prepare for, detect, contain and recover from a security breach, with the aim of limiting damage and reducing downtime.',
    fact: 'Incident response aims to limit damage and reduce downtime after a security breach.',
    falseFact: 'Incident response is carried out only after all systems have been permanently shut down.',
    blank: 'Preparation, containment and recovery are stages of ____.',
  },
  {
    id: 'c-09',
    term: 'Access Control',
    definition:
      'The practice of granting each user only the permissions their role genuinely requires, so that a compromised account cannot reach data beyond its purpose.',
    fact: 'Access control grants each user only the permissions their role genuinely requires.',
    falseFact: 'Access control means every user in an organisation is given administrator rights.',
    blank: 'Giving a student account read-only rights to a shared folder is an example of ____.',
  },
  {
    id: 'c-10',
    term: 'Social Engineering',
    definition:
      'Manipulating a person rather than a system, using urgency, authority or familiarity to persuade them to hand over information or perform an action they otherwise would not.',
    fact: 'Social engineering manipulates a person rather than exploiting a technical weakness.',
    falseFact: 'Social engineering is a technique for designing more efficient network hardware.',
    blank: 'An attacker phoning a staff member and pretending to be IT support is using ____.',
  },
  {
    id: 'c-11',
    term: 'Patch Management',
    definition:
      'The routine of tracking, testing and applying vendor updates so that known vulnerabilities in software are closed before an attacker can use them.',
    fact: 'Patch management closes known vulnerabilities before an attacker can use them.',
    falseFact: 'Patch management is the process of physically repairing damaged network cables.',
    blank: 'Applying vendor security updates on a regular schedule is called ____.',
  },
  {
    id: 'c-12',
    term: 'Backup',
    definition:
      'A separate copy of important data kept so that it can be restored if the original is lost, corrupted or encrypted by ransomware.',
    fact: 'A backup allows data to be restored after it is lost, corrupted or encrypted by ransomware.',
    falseFact: 'A backup prevents ransomware from ever reaching a computer in the first place.',
    blank: 'Keeping a separate restorable copy of important files is called a ____.',
  },
  {
    id: 'c-13',
    term: 'Password Policy',
    definition:
      'A set of rules covering how long a password must be, what it may contain and how often it must change, meant to make guessing and cracking impractical.',
    fact: 'A password policy sets rules for length, content and how often a password must change.',
    falseFact: 'A password policy stores every user password in a shared spreadsheet for reference.',
    blank: 'Rules requiring at least 12 characters and a symbol form part of a ____.',
  },
  {
    id: 'c-14',
    term: 'Virtual Private Network',
    definition:
      'A service that creates an encrypted tunnel between a device and a remote server, hiding traffic from anyone watching the local network.',
    fact: 'A virtual private network encrypts traffic between a device and a remote server.',
    falseFact: 'A virtual private network makes internet connections faster by removing encryption.',
    blank: 'Connecting through an encrypted tunnel to hide your traffic uses a ____.',
  },
  {
    id: 'c-15',
    term: 'Antivirus',
    definition:
      'Software that scans files and running programs against known threat signatures and suspicious behaviour, then quarantines or removes what it finds.',
    fact: 'Antivirus software scans files against known threat signatures and suspicious behaviour.',
    falseFact: 'Antivirus software prevents a user from ever downloading a file from the internet.',
    blank: 'Software that scans and quarantines infected files is called ____.',
  },
  {
    id: 'c-16',
    term: 'Ransomware',
    definition:
      'Malware that encrypts a victim’s files and demands payment in exchange for the key, often spreading across a network before it is noticed.',
    fact: 'Ransomware encrypts a victim’s files and demands payment for the decryption key.',
    falseFact: 'Ransomware openly deletes files immediately so that the victim notices at once.',
    blank: 'Malware that locks your files and demands payment is called ____.',
  },
  {
    id: 'c-17',
    term: 'Spam',
    definition:
      'Unsolicited bulk messages sent to large numbers of recipients, often advertising, and frequently used as a delivery route for phishing links.',
    fact: 'Spam is often used as a delivery route for phishing links.',
    falseFact: 'Spam refers to messages a user has explicitly subscribed to receive.',
    blank: 'Unsolicited bulk email sent to many recipients at once is called ____.',
  },
  {
    id: 'c-18',
    term: 'Digital Footprint',
    definition:
      'The trail of data a person leaves behind online through posts, searches, purchases and account activity, much of which persists after deletion.',
    fact: 'A digital footprint often persists even after the original post is deleted.',
    falseFact: 'A digital footprint disappears completely as soon as a user deletes their account.',
    blank: 'The trail of data you leave behind online is your ____.',
  },
  {
    id: 'c-19',
    term: 'Cyberbullying',
    definition:
      'Repeated harassment, threats or humiliation carried out through digital channels, where the audience is larger and the record more permanent than offline.',
    fact: 'Cyberbullying leaves a more permanent record than offline bullying.',
    falseFact: 'Cyberbullying only counts when the people involved have met in person.',
    blank: 'Repeated harassment carried out through digital channels is ____.',
  },
  {
    id: 'c-20',
    term: 'Netiquette',
    definition:
      'The conventions of courteous behaviour online, such as not writing in all capitals, crediting sources and considering how a message will be read.',
    fact: 'Netiquette includes crediting sources and considering how a message will be read.',
    falseFact: 'Netiquette is a law that carries criminal penalties for impolite messages.',
    blank: 'The conventions of courteous behaviour online are known as ____.',
  },
  {
    id: 'c-21',
    term: 'Intellectual Property',
    definition:
      'Creations of the mind such as writing, music, software and designs, which the creator has legal rights over and which others may not reuse freely.',
    fact: 'Intellectual property gives the creator legal rights over their own work.',
    falseFact: 'Intellectual property means anything published online is free for anyone to reuse.',
    blank: 'Writing, music and software are protected as ____.',
  },
  {
    id: 'c-22',
    term: 'Plagiarism',
    definition:
      'Presenting someone else’s words, ideas or work as your own without acknowledgement, whether copied word for word or reworded.',
    fact: 'Plagiarism includes rewording someone else’s idea without acknowledging the source.',
    falseFact: 'Plagiarism only occurs when text is copied word for word.',
    blank: 'Presenting another person’s work as your own is ____.',
  },
  {
    id: 'c-23',
    term: 'Cookies',
    definition:
      'Small files a website stores in the browser to remember a visitor between pages and visits, which can also be used to track browsing across sites.',
    fact: 'Cookies can be used to track a visitor’s browsing across different websites.',
    falseFact: 'Cookies are programs that run on their own and can install software.',
    blank: 'Small files a website stores in your browser to remember you are called ____.',
  },
  {
    id: 'c-24',
    term: 'HTTPS',
    definition:
      'The secure version of the web protocol, which encrypts the traffic between a browser and a site so that it cannot be read or altered in transit.',
    fact: 'HTTPS encrypts traffic so it cannot be read or altered in transit.',
    falseFact: 'HTTPS guarantees that the website you are visiting is honest and trustworthy.',
    blank: 'The padlock in a browser’s address bar means the site is using ____.',
  },
  {
    id: 'c-25',
    term: 'Public Wi-Fi Risk',
    definition:
      'The danger that an open network shared with strangers allows others to intercept unencrypted traffic or impersonate the network entirely.',
    fact: 'On public Wi-Fi, others on the same network may intercept unencrypted traffic.',
    falseFact: 'Public Wi-Fi is safe as long as the network appears in the list of available networks.',
    blank: 'Logging into your bank over an open cafe network is an example of ____.',
  },
  {
    id: 'c-26',
    term: 'Identity Theft',
    definition:
      'Using another person’s personal details without permission to open accounts, make purchases or impersonate them.',
    fact: 'Identity theft uses another person’s details to open accounts or make purchases.',
    falseFact: 'Identity theft requires the attacker to physically steal a wallet or ID card.',
    blank: 'Using someone else’s personal details to open an account is ____.',
  },
  {
    id: 'c-27',
    term: 'National Privacy Commission',
    definition:
      'The independent Philippine body created by the Data Privacy Act to monitor compliance, receive complaints and enforce personal data protection.',
    fact: 'The National Privacy Commission receives complaints and enforces data protection.',
    falseFact: 'The National Privacy Commission was created by the Cybercrime Prevention Act.',
    blank: 'Complaints about mishandled personal data in the Philippines go to the ____.',
  },
  {
    id: 'c-28',
    term: 'Personal Information',
    definition:
      'Any data from which a person’s identity is apparent or can reasonably be worked out, whether on its own or combined with other information held.',
    fact: 'Personal information includes data that identifies someone when combined with other records.',
    falseFact: 'Personal information covers only a person’s full name and nothing else.',
    blank: 'Data from which a person’s identity can reasonably be worked out is ____.',
  },
  {
    id: 'c-29',
    term: 'Data Subject',
    definition:
      'The individual whose personal information is being collected, held or processed, and who holds rights over how that information is used.',
    fact: 'A data subject is the individual whose personal information is being processed.',
    falseFact: 'A data subject is the organisation that collects and stores personal information.',
    blank: 'The person whose personal data is being processed is called the ____.',
  },
  {
    id: 'c-30',
    term: 'Least Privilege',
    definition:
      'The principle that an account should hold the smallest set of permissions needed for its task, and nothing beyond it, even temporarily.',
    fact: 'Least privilege gives an account only the permissions its task actually needs.',
    falseFact: 'Least privilege means giving new accounts full rights and removing them later.',
    blank: 'Granting an account only the permissions its task needs is the principle of ____.',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Store — sessionStorage so a page reload during review keeps the past-tests
// list populated. Real history lives in `practice_tests` from Phase 2.
// ─────────────────────────────────────────────────────────────────────────────

interface StoredTest {
  test: GeneratedTest;
  /** index → correct answer. Never leaves this module until the test is completed. */
  key: Record<number, string>;
  explanations: Record<number, string>;
  latency: Record<number, number>;
  completedAt: string | null;
}

const STORE_KEY = 'learnsync_testmode_fixture_v1';

function readStore(): Record<string, StoredTest> {
  try {
    return JSON.parse(sessionStorage.getItem(STORE_KEY) ?? '{}') as Record<string, StoredTest>;
  } catch {
    return {};
  }
}

function writeStore(store: Record<string, StoredTest>): void {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    /* quota or private mode — the flow still works for the current screen */
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/* Real generation takes 10–20s. Kept short here so the loading state can be seen
 * without making every click-through painful. */
const GENERATE_MS = 2600;
const SAVE_MS = 140;

let seq = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

function shorten(text: string, max = 120): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/**
 * `count` concepts from `lesson` that are not in `exclude`, walking forward from
 * `from`. Deterministic, so a test looks the same each time it is reviewed.
 *
 * Used for distractors only — a distractor produces no telemetry row, so it is
 * fine for it to be a concept that carries its own question elsewhere.
 */
function otherThan(
  lesson: CannedConcept[],
  exclude: Set<string>,
  from: number,
  count: number
): CannedConcept[] {
  const out: CannedConcept[] = [];
  for (let i = 1; i <= lesson.length && out.length < count; i++) {
    const c = lesson[(from + i) % lesson.length];
    if (!exclude.has(c.id) && !out.some((o) => o.id === c.id)) out.push(c);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Question construction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ONE QUESTION PER CONCEPT. `cursor` only ever moves forward, so no concept can
 * appear twice in a test — which is the whole point of `allocateConcepts()`, and
 * what stops one concept collecting four BKT observations in a single sitting.
 *
 * Distractors are the exception: they reuse other concepts' definitions, but a
 * distractor is only text on screen and produces no telemetry row.
 */
function buildQuestions(
  items: { format: QuestionFormat; count: number }[],
  lesson: CannedConcept[]
): { questions: TestQuestion[]; key: Record<number, string>; explanations: Record<number, string> } {
  const questions: TestQuestion[] = [];
  const key: Record<number, string> = {};
  const explanations: Record<number, string> = {};
  let cursor = 0;

  const record = (q: TestQuestion, answer: string, concept: CannedConcept) => {
    questions.push(q);
    key[q.index] = answer;
    explanations[q.index] = `${concept.term} — ${concept.definition}`;
  };

  for (const { format, count } of items) {
    if (format === 'matching_type') {
      // `allocateConcepts` guarantees a multiple of four, so every block here is
      // a full one. A short trailing block must never be produced.
      for (let start = 0; start + MATCH_TERMS_PER_BLOCK <= count; start += MATCH_TERMS_PER_BLOCK) {
        const terms = lesson.slice(cursor, cursor + MATCH_TERMS_PER_BLOCK);
        cursor += MATCH_TERMS_PER_BLOCK;

        const termIds = new Set(terms.map((c) => c.id));
        const decoys = otherThan(
          lesson,
          termIds,
          cursor,
          MATCH_OPTIONS_PER_BLOCK - MATCH_TERMS_PER_BLOCK
        );
        const pool = [...terms, ...decoys].map((c) => shorten(c.definition, 90));
        // Deterministic scatter. Listing the four answers first would make them
        // A, B, C, D in order, which is guessable and would make the results
        // screen look wrong even when it is right.
        const options = [3, 0, 5, 1, 4, 2].filter((i) => i < pool.length).map((i) => pool[i]);
        const blockId = nextId('block');

        terms.forEach((concept, i) => {
          const q: MatchingQuestion = {
            index: questions.length,
            concept_id: concept.id,
            concept_term: concept.term,
            format: 'matching_type',
            difficulty: 'foundational',
            prompt: concept.term,
            blockId,
            options,
          };
          record(q, pool[i], concept);
        });
      }
      continue;
    }

    for (let i = 0; i < count && cursor < lesson.length; i++) {
      const at = cursor;
      const concept = lesson[cursor++];
      const index = questions.length;
      const base = {
        index,
        concept_id: concept.id,
        concept_term: concept.term,
        difficulty: 'foundational' as const,
      };

      if (format === 'multiple_choice') {
        const correct = shorten(concept.definition, 100);
        const options = otherThan(lesson, new Set([concept.id]), at, 3).map((c) =>
          shorten(c.definition, 100)
        );
        options.splice(index % 4, 0, correct);
        record(
          { ...base, format, prompt: `Which of the following best describes ${concept.term}?`, options },
          correct,
          concept
        );
      } else if (format === 'true_or_false') {
        const isTrue = index % 2 === 0;
        record(
          { ...base, format, prompt: isTrue ? concept.fact : concept.falseFact },
          isTrue ? 'true' : 'false',
          concept
        );
      } else if (format === 'identification') {
        record({ ...base, format, prompt: concept.definition }, concept.term, concept);
      } else {
        const prompt = concept.blank.includes(BLANK_TOKEN)
          ? concept.blank
          : `${concept.definition} This describes ${BLANK_TOKEN}.`;
        record({ ...base, format, prompt }, concept.term, concept);
      }
    }
  }

  return { questions, key, explanations };
}

/** Same leniency the server will need: case, spacing and surrounding punctuation. */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isCorrect(expected: string, given: string | null): boolean {
  if (!given) return false;
  return normalise(expected) === normalise(given);
}

function summarise(stored: StoredTest): TestSummary {
  const { test } = stored;
  const answered = Object.keys(test.answers).length;
  return {
    id: test.id,
    title: test.title,
    material_id: test.material_id,
    created_at: test.created_at,
    status: test.status,
    score:
      test.status === 'completed'
        ? gradeAll(stored).filter((r) => r.is_correct).length / Math.max(1, test.questions.length)
        : null,
    total: test.questions.length,
    answered,
    formats: test.formats,
  };
}

function gradeAll(stored: StoredTest): QuestionResult[] {
  return stored.test.questions.map((q) => {
    const given = stored.test.answers[q.index] ?? null;
    return {
      index: q.index,
      concept_id: q.concept_id,
      concept_term: q.concept_term,
      format: q.format,
      prompt: q.prompt,
      student_answer: given,
      correct_answer: stored.key[q.index],
      is_correct: isCorrect(stored.key[q.index], given),
      explanation: stored.explanations[q.index] ?? '',
    };
  });
}

function buildResult(stored: StoredTest): TestResult {
  const results = gradeAll(stored);
  const correct = results.filter((r) => r.is_correct).length;

  const byConcept = new Map<string, MissedConcept>();
  for (const r of results) {
    const entry = byConcept.get(r.concept_id) ?? {
      concept_id: r.concept_id,
      term: r.concept_term,
      wrong: 0,
      asked: 0,
    };
    entry.asked += 1;
    if (!r.is_correct) entry.wrong += 1;
    byConcept.set(r.concept_id, entry);
  }

  const { questions: _q, answers: _a, ...test } = stored.test;

  return {
    test,
    score: correct / Math.max(1, results.length),
    correct,
    total: results.length,
    results,
    missed_concepts: [...byConcept.values()]
      .filter((c) => c.wrong > 0)
      .sort((a, b) => b.wrong - a.wrong || a.term.localeCompare(b.term)),
    elapsed_ms: Object.values(stored.latency).reduce((sum, n) => sum + n, 0),
  };
}

// ─────────────────────────────────────────────────────────────────────────────

export const fixtureTestApi: TestApi = {
  async list(spaceId) {
    await sleep(200);
    const store = readStore();
    return Object.values(store)
      .filter((s) => s.test.space_id === spaceId)
      .sort((a, b) => (a.test.created_at < b.test.created_at ? 1 : -1))
      .map(summarise);
  },

  async generate(req: GenerateTestRequest) {
    await sleep(GENERATE_MS);

    // PHASE 2: the server counts `concepts` itself and never trusts the client.
    // Here the canned lesson is the ceiling — with live materials at 28 and 29
    // concepts against 30 canned ones, this never actually truncates.
    const lesson = LESSON.slice(0, Math.min(req.concept_count, LESSON.length));
    const alloc = allocateConcepts(lesson.length, req.formats);
    const { questions, key, explanations } = buildQuestions(alloc.items, lesson);
    const formats = orderedFormats(alloc.items.map((i) => i.format));

    const test: GeneratedTest = {
      id: nextId('test'),
      title: req.title,
      space_id: req.space_id,
      material_id: req.material_id,
      formats,
      difficulty_tier: 'foundational',
      questions,
      status: 'in_progress',
      created_at: new Date().toISOString(),
      answers: {},
    };

    const store = readStore();
    store[test.id] = { test, key, explanations, latency: {}, completedAt: null };
    writeStore(store);
    return structuredClone(test);
  },

  async saveAnswer(testId, index, answer, latencyMs) {
    await sleep(SAVE_MS);
    const store = readStore();
    const stored = store[testId];
    if (!stored) throw new Error('Test not found');
    if (stored.test.status === 'completed') return;
    stored.test.answers[index] = answer;
    stored.latency[index] = (stored.latency[index] ?? 0) + latencyMs;
    writeStore(store);
  },

  async complete(testId) {
    await sleep(500);
    const store = readStore();
    const stored = store[testId];
    if (!stored) throw new Error('Test not found');
    stored.test.status = 'completed';
    stored.completedAt = new Date().toISOString();
    writeStore(store);
    return buildResult(stored);
  },

  async fetchResult(testId) {
    await sleep(250);
    const stored = readStore()[testId];
    if (!stored) throw new Error('Test not found');
    return buildResult(stored);
  },

  async resume(testId) {
    await sleep(250);
    const stored = readStore()[testId];
    if (!stored) throw new Error('Test not found');
    return structuredClone(stored.test);
  },
};
