# Groq → Gemini migration — session prompts

**Branch:** the all-Gemini migration branch.
**Goal:** remove `server/lib/groq.ts` entirely; every workload it served runs on Gemini.
**Companion file:** `MIGRATION_PROMPTS_CEREBRAS.md` — the gpt-oss-120b alternative, built on a
separate branch for side-by-side output comparison.

Each numbered prompt is designed to be pasted into a session. **Run them in order** — Prompt 1 adds
the model constants everything else depends on, and Prompt 5 deletes Groq, so nothing can fall back
to it afterwards. **Commit after each one**, so a bad result costs you one feature and not the whole
migration.

---

## Why this migration exists

Groq deprecated `llama-3.3-70b-versatile` and `llama-3.1-8b-instant` on **17 June 2026**. Verified
against the live key on **17 August 2026**: both return *"The model does not exist or you do not have
access to it."* **Every Groq-backed feature is broken in production right now.**

Groq's paid tier is also closed to new signups, so Groq cannot scale to the 50-student study
regardless of which model is used.

---

## Facts a fresh session needs

### Seven call sites, two dead models

| File | Line ≈ | Function | Dead model | `max_tokens` |
|---|---|---|---|---|
| `server/lib/groq.ts` | 293 | `generateQuestionsForConcepts` | 70b-versatile | 2048 per batch of 20 |
| `server/lib/groq.ts` | 420 | `generateTermMatches` | 8b-instant | 2048 |
| `server/lib/groq.ts` | 492 | `generateTrivia` | 70b-versatile | 4096 |
| `server/lib/groq.ts` | 562 | `generateCrosswordWords` | 70b-versatile | 3072 |
| `server/lib/groq.ts` | 593 | `streamChatCompletion` | 8b-instant | 2048 |
| `server/lib/testGeneration.ts` | 140 | adaptive test generation | 70b-versatile | dynamic |

### Consumers to update

- `server/routes/chat.routes.ts` → `streamChatCompletion`
- `server/routes/games.routes.ts` → `generateTermMatches`, `generateTrivia`, `generateCrosswordWords`
- `server/routes/studyspaces.routes.ts` → `generateQuestionsForConcepts`
- `server/routes/practice.routes.ts` → catches `GroqUnavailableError`
- `server/lib/testGeneration.ts` → imports `groq`, `withGroq`

### What `server/lib/gemini.ts` already provides

`generateJson()` · `generateContent()` · `generateEmbedding()` · `generateJsonFromDocument()` ·
`GeminiUnavailableError` · `GeminiQuotaError` · the three model constants.

**Four of the five Groq functions map straight onto `generateJson()`. Only chat streaming needs new
code.**

### Measured latency — 17–18 Aug 2026, real keys, 120-word prompt

**⚠️ Read the caveat before quoting these numbers.** Gemini latency was highly variable across
repeated runs of an identical request. Five samples of `gemini-3.5-flash-lite` at MINIMAL gave
1.8 / 2.1 / 1.8 / 1.9 / 1.9s — tight. But `gemini-3.6-flash` at MINIMAL gave 1.9–2.6s in one run and
4.2–20.9s an hour later, same prompt, same settings. **Treat any single measurement as an anecdote.**

| Model | Thinking | Typical total | Notes |
|---|---|---|---|
| `gemini-3.5-flash-lite` | MINIMAL | **~1.9s** | most consistent of everything tested |
| `gemini-3.6-flash` | MINIMAL | ~2.3s, but spiked to 20s | usable, variable |
| `gemini-3.6-flash` | LOW | ~5–7s, spiked to 32s | |
| `gemini-3.6-flash` | MEDIUM | ~8s+ | |

> ⚠️ **Thinking costs both latency and money — thinking tokens are billed at the OUTPUT rate.** The
> direction is certain even though the multiples are noisy. Every migrated call must set
> `thinkingLevel` explicitly. None of these workloads needs thinking: test scoring is deterministic
> (`server/lib/testGrading.ts`), so no model judgement becomes a number a student is shown.

### ⛔ Do NOT use `gemini-3.7-flash` — verified 18 Aug 2026

It looks attractive (launched 13 Aug 2026, headline "50% introductory price cut") and a future session
will be tempted to "upgrade" to it. Three measured reasons not to:

1. **It rejects `MINIMAL` thinking outright** — `HTTP 400: "Thinking level MINIMAL is not supported for
   this model."` Its floor is `LOW`. Since thinking tokens bill at the output rate, its cheapest
   possible call is more expensive than `gemini-3.6-flash` at MINIMAL. **The discount is undercut by
   the thinking floor.**
2. **It is not reliably available.** Five consecutive requests at `LOW`: **four failed** with
   *"This model is currently experiencing high demand."* The one success took 8.9s. That is an
   unacceptable failure rate for a 50-student study.
3. **It is not actually cheaper than `gemini-3.6-flash` today.** Both are $0.75 / $3.75 per 1M under
   introductory pricing through 31 Dec 2026, both rising to $1.50 / $7.50 on 1 Jan 2027. The
   advertised "50% cut" is measured against 3.7's own future standard price, not against 3.6's
   current price.

Re-evaluate after the study if its availability improves and it gains MINIMAL support. Not before.

### Real data shape (live database, 17 Aug 2026)

3 live materials · 99 concepts · **avg 33 concepts per material, max 42** · avg 177 characters per
concept (term + definition).

---

## Rules that must not break

A fresh session must read `CLAUDE.md`, but these are the ones this migration specifically threatens:

1. **Never change the embedding model.** `gemini-embedding-001` is fixed; every stored vector is
   3072-dimensional. This migration must not touch `generateEmbedding()`.
2. **Never send `temperature` to a `gemini-3*` model.** Gemini 3 dropped the sampling parameters.
   `generateJson()` strips it and logs a warning; treat that warning as a call-site bug.
   ⚠️ Four Groq call sites currently pass `temperature` (0.2, 0.6, 0.7, 0.6). **Delete them — do not
   port them.**
3. **Set `thinkingLevel` and `maxOutputTokens` explicitly on every Gemini 3 call**, or a tight budget
   truncates the response and surfaces as unparseable JSON.
4. **The model echoes an INDEX, never a `concept_id`,** and every echo stays range-checked against its
   batch. A wrong id attaches mastery to the wrong concept and nothing downstream can detect it.
5. **A model never writes a flashcard answer.** The back is the educator's `definition`, verbatim.
   Only the front varies.
6. **`QUESTION_BATCH_SIZE = 20` stays.** The one-call-per-deck version truncated on real materials.
7. **A concept the model skips falls back to its term** — a card is never lost and never unlinked.
8. **A failed generation call aborts with 502 before anything is written.** A deck half questions and
   half terms is worse than a clean retry.
9. **Games READ mastery and never write it.** Nothing here may import `server/lib/bkt.ts`;
   `bkt_source` stays a two-value enum.
10. **`stripKey()` is the only function that serialises a test question to a client.** Do not add a
    second serialiser, and never let the answer key reach the browser mid-test.

---

## Prompt 1 — model constants + adaptive test generation

> Merged from what were two prompts. The constants alone produced nothing testable, so they now
> land together with the first feature that uses them. The **streaming helper moved to Prompt 4**,
> where it is actually needed — nothing before that streams.

```
Read CLAUDE.md and "LearnSyncAI artifacts/MIGRATION_PROMPTS_GEMINI.md" first.

This is the first step of migrating every Groq workload to Gemini. It does two things: it sets
up the model constants the whole migration depends on, and it migrates the first feature.

PART A — model constants

In server/lib/gemini.ts, add model constants for the migrated workloads, following the existing
GEMINI_EXTRACTION_MODEL / GEMINI_GRADING_MODEL / GEMINI_UTILITY_MODEL pattern and documenting
them in the same style. Content generation (tests, games, flashcard questions) uses
gemini-3.6-flash; the chatbot uses gemini-3.5-flash-lite.

Explain WHY in the comment: no migrated call produces a number a student is shown, so by
CLAUDE.md's own rule none of them needs the grading model — but distractor quality is measurably
hard (see the Games section of CLAUDE.md), which is why content generation gets the stronger
model while chat gets the faster one.

Do NOT use gemini-3.7-flash. It rejects MINIMAL thinking with HTTP 400, and 4 of 5 test requests
failed with "experiencing high demand" on 18 Aug 2026. See the migration file for the evidence.

Do NOT touch generateEmbedding(), the embedding model, or any existing caller of generateJson().
Do not delete groq.ts — later prompts still reference it.

PART B — adaptive test generation

Target: server/lib/testGeneration.ts — it imports { groq, withGroq } from './groq' and calls
llama-3.3-70b-versatile (decommissioned) at around line 140.

Requirements:
- Use generateJson() from server/lib/gemini.ts with the content-generation model constant.
- Set thinkingLevel to MINIMAL and set maxOutputTokens explicitly. Measured: gemini-3.6-flash
  takes 20s at LOW and 54s at MEDIUM versus 2s at MINIMAL, and thinking tokens bill at the
  output rate. Nothing here needs thinking — grading is deterministic in testGrading.ts.
- DELETE the temperature: 0.2. Gemini 3 ignores sampling parameters and generateJson() strips
  it with a warning. Preserve the INTENT (stable factual content across generations, the
  paper's Content Consistency check on p. 98) with a responseSchema, and rewrite the comment
  to describe what we actually guarantee now rather than a guarantee we no longer have.
- Keep the index-echo contract exactly: the model returns an index, never a concept_id, and
  every index stays range-checked against its batch.
- Map GroqUnavailableError to GeminiUnavailableError in server/routes/practice.routes.ts,
  which currently catches the Groq type.
- Preserve one-question-per-concept allocation via server/lib/testAllocation.ts. The student
  does not choose the test length and the model must not either.
- A matching block stays 4 terms against 6 options, and emits 4 telemetry rows.

Verify:
- npm run lint
- Generate a real test against a real material end to end. Confirm: question count equals
  concept count, every concept_id resolves, the matching block shape is right, and the answer
  key never reaches the client (stripKey).
- Complete the test and confirm bkt_update_logs row count equals practice_telemetry row count.
- Report actual wall-clock generation time.
```

---

## Prompt 2 — flashcard question generation

```
Read CLAUDE.md and "LearnSyncAI artifacts/MIGRATION_PROMPTS_GEMINI.md" first.
Prompt 1 (model constants + adaptive tests) is already done.

Migrate flashcard question generation from Groq to Gemini.

Target: generateQuestionsForConcepts() in server/lib/groq.ts (~lines 255-300), called from
server/routes/studyspaces.routes.ts. Move it into a new server/lib/questionGeneration.ts — it
must not stay in groq.ts, which is deleted in Prompt 5.

Requirements:
- generateJson() with the content-generation model, thinkingLevel MINIMAL, explicit
  maxOutputTokens.
- KEEP QUESTION_BATCH_SIZE = 20. The single-call version truncated on real materials. At 33
  concepts average and 42 max, that is 2-3 batches.
- KEEP the index echo and its range check.
- KEEP the fallback: a concept the model skips falls back to its term, so a card is never lost
  and never unlinked from its concept.
- KEEP abort-on-throw: a failed call must 502 before any card is written. A deck half questions
  and half terms is worse than a clean retry.
- The model must NEVER write the answer. The back of every card is the educator's definition,
  verbatim.
- is_ai_generated stays true ONLY for cards whose question actually came back from the model —
  false for term cards and for question-format cards that fell back.

Verify:
- npm run lint
- Generate a question-format deck against a real material. Confirm card count equals concept
  count, every back matches its concept definition exactly, and is_ai_generated is correct per
  card.
- Re-generate the same material into the same deck with replace:true and confirm it reconciles
  by concept_id rather than delete-then-insert — spaced_repetition_logs rows must survive and
  next_review_at must not reset.
- Report wall-clock time for a full deck.
```

---

## Prompt 3 — gamification (trivia, crossword, term matches)

```
Read CLAUDE.md and "LearnSyncAI artifacts/MIGRATION_PROMPTS_GEMINI.md" first.
Prompts 1 and 2 are already done.

Migrate all three game generators from Groq to Gemini.

Targets in server/lib/groq.ts, called from server/routes/games.routes.ts:
- generateTermMatches()    (~line 388, max_tokens 2048, temperature 0.6)
- generateTrivia()         (~line 441, max_tokens 4096, temperature 0.7)
- generateCrosswordWords() (~line 522, max_tokens 3072, temperature 0.6)
Move them into server/lib/gameContent.ts.

Requirements:
- generateJson() with the content-generation model, thinkingLevel MINIMAL, and maxOutputTokens
  matching the old max_tokens budgets above.
- DELETE all three temperature values — Gemini 3 ignores them. Note in the comment that the
  variety they provided now comes from the weighted concept sampling in
  server/lib/gameDifficulty.ts (Efraimidis-Spirakis A-Res), which is what actually makes
  "Play Again" produce a different game.
- READ the Games section of CLAUDE.md before touching any prompt text. The difficulty lives in
  the DISTRACTORS, not the question. Three separate attempts to make questions harder produced,
  in order: invented facts, ungrammatical fragments, and subjectless stems naming no concept.
  Port the prompts FAITHFULLY and change only the transport. Do not "improve" them.
- Trivia's reading budget must stay two-sided — a word target to aim for, not a ceiling to duck
  under. Stated one-sided, the model collapsed advanced questions to "What is XSS?", the
  easiest output of the three tiers.
- Crossword: keep the "A-Z, 3-10 letters" and "NEVER abbreviate" rules tier-independent and
  adjacent to the tier'd answer line. groq.ts filtered that range, crossword.ts needs at least
  2 survivors, and the route throws on an empty layout — that is where a 502 would come from.
- Games READ mastery and never write it. Do not import server/lib/bkt.ts.
- The server derives difficulty from M_doc. GenerateGameContentSchema has no difficulty field
  and must not gain one.
- The trivia timer stays server-authoritative and stored in the payload (20s/15s/10s).

Verify:
- npm run lint
- Generate all three game types against a real material at each of the three tiers, using
  npx tsx scripts/set-test-mastery.ts <tier>, then reset when done.
- For trivia, READ 10 generated questions yourself and check for invented facts. That is the
  documented failure mode and a type-check will not catch it.
- Confirm the stored game_content row carries the server-derived difficulty and mastery_snapshot.
- Report wall-clock time per game type.
```

---

## Prompt 4 — chatbot streaming

```
Read CLAUDE.md and "LearnSyncAI artifacts/MIGRATION_PROMPTS_GEMINI.md" first.
Prompts 1-3 are already done. This is the only feature needing genuinely new code.

Migrate the RAG chatbot from Groq streaming to Gemini streaming.

Target: streamChatCompletion() in server/lib/groq.ts (~line 589), called from
server/routes/chat.routes.ts, which streams Server-Sent Events to the browser.

FIRST, build the streaming helper. server/lib/gemini.ts has no streaming function yet —
generateJson() and generateContent() both wait for the whole response. Add streamContent() (or
similar), mirroring how generateJson() handles config, errors and thinking level. It must:
  - accept a system instruction, message history, and a thinkingLevel
  - yield text chunks as they arrive
  - throw GeminiUnavailableError / GeminiQuotaError consistently with the rest of the module
This is the only genuinely new code in the whole migration; every other prompt reused
generateJson().

Then migrate the route.

Requirements:
- Use that helper with the chat model constant (gemini-3.5-flash-lite) and thinkingLevel
  MINIMAL. That combination was the most consistent thing measured: 1.8/2.1/1.8/1.9/1.9s across
  five samples.
- The SSE wire format must NOT change: data: {"token": "..."} per chunk, then
  data: {"done": true}, then res.end(). ResourcesTab.tsx parses exactly this, and that call is
  the one documented exception to the "never use raw fetch" rule. Do not touch the client.
- Preserve both modes: 'rag' (match_count 8 via similarity search) and 'full' (all concepts of
  exactly ONE material). Gemini's context window is far larger than Groq's, so the >6000-token
  413 guard can be relaxed — but keep a limit and document the new number.
- Preserve the refusal path for off-topic questions, and the chatbot_logs write after the
  stream completes.
- Preserve the error path: if headers are already sent, emit data: {"error": "Stream
  interrupted"} rather than attempting a JSON error response.
- Keep history at the last 4 messages.
- chat.routes.ts must keep requireRole('student') on BOTH routes and must keep calling
  rejectInaccessibleMaterials() on the body's material_ids. Those gates exist because the
  route previously mounted authenticate alone — an educator could drive the student chatbot.

Verify:
- npm run lint
- Ask a real question in the deployed UI in rag mode; confirm tokens stream progressively
  rather than arriving in one block.
- Ask a summary question in full mode against one material.
- Ask an off-topic question and confirm the refusal still streams.
- Confirm a chatbot_logs row is written.
- Report time to first token as experienced in the browser, not just server-side.
```

---

## Prompt 5 — delete Groq and verify the whole system

```
Read CLAUDE.md and "LearnSyncAI artifacts/MIGRATION_PROMPTS_GEMINI.md" first.
Prompts 1-4 are done. Nothing should still call Groq.

Remove Groq from the project entirely.

1. Confirm nothing imports it:
   grep -rn "groq" server/ src/ --include=*.ts --include=*.tsx
2. Delete server/lib/groq.ts.
3. Remove groq-sdk from package.json and update package-lock.json.
4. Remove GROQ_API_KEY from .env and .env.example, and TELL ME to remove it from Render's
   environment variables — I must do that in the dashboard myself.
5. Update CLAUDE.md and ARCHITECTURE.md. The "Adaptive test generation is on Groq, not Gemini"
   section and every Groq free-tier quota warning are now false. Replace them with what is
   true, include the measured thinking-level latency table, and KEEP the historical note that
   Groq was used and why it was dropped (models decommissioned 17 June 2026; paid tier closed
   to new signups).
6. GEMINI_LEGACY_TEXT_MODEL still has no callers and is still generateJson()'s default.
   CLAUDE.md has flagged that default as a trap for the next call site. Remove the default,
   make `model` required, and update every call site.

Verify the full system:
- npm run lint
- npx vite build
- npx tsx scripts/bkt-verify.ts must still report 165/165
- Exercise every migrated feature once against real data
- Confirm no route lost its auth gates

Report a summary I can use as a commit message.
```

---

## Cost estimate — 50 students × 2 weeks

**Assumptions.** Derived from the live database (33 concepts/material, 177 chars/concept ≈ 45 tokens)
and a per-student fortnight of: 6 adaptive tests, 3 flashcard deck generations, 6 games, 30 chat
messages.

| Workload | Calls | Input | Output |
|---|---|---|---|
| Adaptive tests | 300 | 0.60M | 0.75M |
| Flashcard questions | 150 | 0.39M | 0.15M |
| Trivia / crossword / matches | 300 | 0.32M | 0.36M |
| Chat | 1,500 | 1.65M | 0.45M |
| **Total (migrated work)** | | **~2.96M** | **~1.71M** |

**Pricing** (introductory, through 31 Dec 2026): `gemini-3.6-flash` $0.75 / $3.75 per 1M;
`gemini-3.5-flash-lite` $0.30 / $2.50 per 1M. **Thinking tokens bill at the output rate.**

| | Cost |
|---|---|
| Content generation on `gemini-3.6-flash` | ~$5.70 |
| Chat on `gemini-3.5-flash-lite` | ~$1.63 |
| **Migrated work at MINIMAL thinking** | **~$7.30** |
| The same work with thinking left at default | **~$16+** |

> ⚠️ The single largest cost risk here is forgetting `thinkingLevel`. Default thinking roughly doubles
> the bill and multiplies latency by 10–27×.

**Unavoidable baseline, unchanged by this migration.** Free Recall, Feynman and concept extraction stay
on Gemini regardless. Both cognitive features run at `ThinkingLevel.MEDIUM` deliberately — `CLAUDE.md`
records that LOW made Free Recall praise a wrong answer — and those thinking tokens bill at the output
rate. Baseline ≈ **$12–13** for the fortnight.

### All-Gemini total ≈ **$20** for the two-week study

Treat every figure as ±2–3×. Real student behaviour is the dominant unknown, and chat volume is the
single most sensitive assumption.
