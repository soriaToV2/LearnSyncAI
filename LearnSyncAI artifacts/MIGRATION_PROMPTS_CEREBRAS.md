# Groq → Cerebras (gpt-oss-120b) migration — session prompts

**Branch:** the Cerebras / gpt-oss migration branch.
**Goal:** keep the current OpenAI-compatible code shape, but point it at Cerebras and swap the dead
model for `gpt-oss-120b`.
**Companion file:** `MIGRATION_PROMPTS_GEMINI.md` — the all-Gemini alternative, built on a separate
branch so the two can be compared side by side.

Each numbered prompt is designed to be pasted into a **fresh session**. Run them in order — Prompt 0
builds the shared client the rest depend on.

---

## Why this is the cheap migration

`groq-sdk` speaks the OpenAI wire format. **So does Cerebras.** Switching providers is a base URL, an
API key and a model name — the function bodies, the JSON parsing, the streaming loop and the SSE
format all stay as they are.

That is the key difference from the Gemini branch, which needs `generateJson()` substituted at four
sites and the chat stream rewritten from scratch against a different SDK.

> **This branch should take a fraction of the time the Gemini branch takes.** If it is turning into a
> rewrite, stop and re-read this section — something has gone wrong.

---

## Why this migration exists

Groq deprecated `llama-3.3-70b-versatile` and `llama-3.1-8b-instant` on **17 June 2026**. Verified
against the live key on **17 August 2026**: both return *"The model does not exist or you do not have
access to it."* **Every Groq-backed feature is broken in production right now.**

Groq's own recommended replacement is `openai/gpt-oss-120b` — the same model Cerebras serves. Groq's
paid tier is closed to new signups, so the model can stay while the provider changes.

---

## Provider facts

| | Value |
|---|---|
| Base URL | `https://api.cerebras.ai/v1` |
| Model | `gpt-oss-120b` (note: **no** `openai/` prefix, unlike Groq) |
| Second model available | `gemma-4-31b` (~1,850 tok/s) |
| Speed | **~3,000 tokens/sec** — roughly 6× Groq, far beyond any Gemini option |
| Context | 65k free tier · 131k paid |
| Env var | `CEREBRAS_API_KEY` |

### Rate limits — the part that decides tiers

| Tier | Requests/min | Tokens/min | Tokens/day |
|---|---|---|---|
| **Free** | **5** | 30K | 1M |
| **Developer (pay as you go)** | **1,000** | 1M | unlimited |

> ⚠️ **The free tier is for development only.** 5 requests/minute cannot serve 50 students — a single
> adaptive test generation consumes a whole minute's budget. The Developer tier is required before
> the study, and **confirming that signups are actually open is a prerequisite**, since that is
> exactly what failed with Groq.

---

## Seven call sites, two dead models

| File | Line ≈ | Function | Dead model | `max_tokens` | temperature |
|---|---|---|---|---|---|
| `server/lib/groq.ts` | 293 | `generateQuestionsForConcepts` | 70b-versatile | 2048 per batch of 20 | — |
| `server/lib/groq.ts` | 420 | `generateTermMatches` | 8b-instant | 2048 | 0.6 |
| `server/lib/groq.ts` | 492 | `generateTrivia` | 70b-versatile | 4096 | 0.7 |
| `server/lib/groq.ts` | 562 | `generateCrosswordWords` | 70b-versatile | 3072 | 0.6 |
| `server/lib/groq.ts` | 593 | `streamChatCompletion` | 8b-instant | 2048 | — |
| `server/lib/testGeneration.ts` | 140 | adaptive test generation | 70b-versatile | dynamic | 0.2 |

**Unlike the Gemini branch, `temperature` is supported and should be kept** — gpt-oss accepts the
sampling parameters. Do not delete those values.

### Consumers

- `server/routes/chat.routes.ts` → `streamChatCompletion`
- `server/routes/games.routes.ts` → `generateTermMatches`, `generateTrivia`, `generateCrosswordWords`
- `server/routes/studyspaces.routes.ts` → `generateQuestionsForConcepts`
- `server/routes/practice.routes.ts` → catches `GroqUnavailableError`
- `server/lib/testGeneration.ts` → imports `groq`, `withGroq`

### Real data shape (live database, 17 Aug 2026)

3 live materials · 99 concepts · **avg 33 concepts per material, max 42** · avg 177 characters per
concept. At 65k context, no prompt in this app comes close to the limit.

---

## The one genuinely new risk: reasoning effort

`gpt-oss-120b` is a **reasoning model**. Like Gemini 3, it may spend part of its output budget
thinking before answering, which can truncate JSON and inflate latency.

It exposes a `reasoning_effort` parameter (`low` / `medium` / `high`). **Set it explicitly to `low` on
every call**, and treat an unparseable JSON response as a symptom of the budget being eaten by
reasoning rather than as a prompt problem.

This is the same class of trap `CLAUDE.md` already records for Gemini 3 thinking tokens. It is the
most likely cause of a migration that "works on small inputs and fails on real materials."

---

## Rules that must not break

Read `CLAUDE.md`, but these are the ones this migration specifically threatens:

1. **Never change the embedding model.** `gemini-embedding-001` is fixed; every stored vector is
   3072-dimensional. **Gemini stays in this project** for embeddings, concept extraction, Free Recall
   and Feynman — this branch only replaces what Groq was doing.
2. **The model echoes an INDEX, never a `concept_id`,** and every echo stays range-checked against its
   batch. A wrong id attaches mastery to the wrong concept, undetectably.
3. **A model never writes a flashcard answer.** The back is the educator's `definition`, verbatim.
4. **`QUESTION_BATCH_SIZE = 20` stays.** The one-call-per-deck version truncated on real materials.
5. **A concept the model skips falls back to its term** — a card is never lost and never unlinked.
6. **A failed generation call aborts with 502 before anything is written.**
7. **Games READ mastery and never write it.** Nothing here may import `server/lib/bkt.ts`.
8. **`stripKey()` is the only function that serialises a test question to a client.**
9. **Model names must end up in ONE place.** They are currently hardcoded at seven sites, which is
   exactly why this deprecation cost seven edits instead of one. `CLAUDE.md` already requires this of
   Gemini ("nowhere else may name a model string"); Groq never followed it. Fix that here.

---

## Prompt 0 — the Cerebras client

```
Read CLAUDE.md and "LearnSyncAI artifacts/MIGRATION_PROMPTS_CEREBRAS.md" first.

We are replacing Groq with Cerebras. Cerebras speaks the OpenAI wire format, so this is a
transport swap, not a rewrite. If you find yourself restructuring function bodies, stop.

Do this:

1. Rename server/lib/groq.ts to server/lib/cerebras.ts and update every import across the
   codebase (chat.routes.ts, games.routes.ts, studyspaces.routes.ts, practice.routes.ts,
   testGeneration.ts).

2. Point the client at Cerebras:
   - base URL https://api.cerebras.ai/v1
   - API key from process.env.CEREBRAS_API_KEY
   Either keep groq-sdk with a custom baseURL, or switch to the official `openai` package —
   pick one, and say in a comment why. Do not leave both.

3. Add named model constants at the top of the file and use them everywhere. Model names are
   currently hardcoded at seven call sites, which is exactly why this deprecation was painful.
   CLAUDE.md already requires this of Gemini; make Cerebras follow the same rule.
   Use gpt-oss-120b for every workload — at ~3000 tokens/sec it is faster than the small model
   it replaces, so the old big/small split is no longer needed. Say that in the comment.

4. Rename GroqUnavailableError / GroqRateLimitError and withGroq() to match, keeping the same
   behaviour and the same catch in practice.routes.ts.

5. Add CEREBRAS_API_KEY to .env and .env.example. Leave GROQ_API_KEY in place for now; it is
   removed in Prompt 5.

6. gpt-oss-120b is a REASONING model. Add reasoning_effort: 'low' to every call and document
   why: reasoning tokens draw on the output budget and can truncate JSON, the same trap
   CLAUDE.md records for Gemini 3 thinking.

Then run `npm run lint` and report what changed.
```

---

## Prompt 1 — adaptive test generation

```
Read CLAUDE.md and "LearnSyncAI artifacts/MIGRATION_PROMPTS_CEREBRAS.md" first.
Prompt 0 (the Cerebras client) is already done.

Migrate adaptive test generation to gpt-oss-120b on Cerebras.

Target: server/lib/testGeneration.ts, which calls llama-3.3-70b-versatile (decommissioned) at
around line 140.

Requirements:
- Use the model constant from Prompt 0. No literal model string in this file.
- KEEP temperature: 0.2 — gpt-oss supports sampling parameters, and the comment explains why
  it is low but not zero (the paper's Content Consistency check, p. 98).
- Set reasoning_effort: 'low' and keep the existing dynamic max_tokens. If JSON comes back
  unparseable on a real 33-concept material, raise max_tokens BEFORE touching the prompt —
  reasoning tokens eat the budget.
- Keep the index-echo contract: the model returns an index, never a concept_id, and every index
  stays range-checked against its batch.
- Preserve one-question-per-concept allocation via server/lib/testAllocation.ts.
- A matching block stays 4 terms against 6 options and emits 4 telemetry rows.

Verify:
- npm run lint
- Generate a real test against a real material end to end. Confirm question count equals
  concept count, every concept_id resolves, the matching block shape is right, and the answer
  key never reaches the client (stripKey).
- Complete the test and confirm bkt_update_logs row count equals practice_telemetry row count.
- Report wall-clock generation time — this is a headline number for comparing against the
  Gemini branch, so record it precisely.
- SAVE one generated test's questions_payload to a file under "LearnSyncAI artifacts/" so the
  output can be diffed against the Gemini branch later.
```

---

## Prompt 2 — flashcard question generation

```
Read CLAUDE.md and "LearnSyncAI artifacts/MIGRATION_PROMPTS_CEREBRAS.md" first.
Prompts 0 and 1 are already done.

Migrate flashcard question generation to gpt-oss-120b on Cerebras.

Target: generateQuestionsForConcepts() in server/lib/cerebras.ts (formerly groq.ts, ~lines
255-300), called from server/routes/studyspaces.routes.ts.

Requirements:
- Model constant from Prompt 0, reasoning_effort: 'low'.
- KEEP QUESTION_BATCH_SIZE = 20 and max_tokens 2048 per batch. At 33 concepts average and 42
  max, that is 2-3 batches. If a batch truncates, raise max_tokens — reasoning tokens are the
  likely cause, not the prompt.
- KEEP the index echo and its range check.
- KEEP the fallback: a concept the model skips falls back to its term.
- KEEP abort-on-throw: a failed call 502s before any card is written.
- The model NEVER writes the answer. The back is the educator's definition, verbatim.
- is_ai_generated stays true only for cards whose question actually came back from the model.

Verify:
- npm run lint
- Generate a question-format deck against a real material. Confirm card count equals concept
  count, every back matches its concept definition exactly, and is_ai_generated is right.
- Re-generate with replace:true and confirm reconciliation by concept_id — spaced_repetition_logs
  must survive and next_review_at must not reset.
- Report wall-clock time for a full deck.
- SAVE the generated questions to "LearnSyncAI artifacts/" for later comparison against Gemini.
```

---

## Prompt 3 — gamification (trivia, crossword, term matches)

```
Read CLAUDE.md and "LearnSyncAI artifacts/MIGRATION_PROMPTS_CEREBRAS.md" first.
Prompts 0-2 are already done.

Migrate all three game generators to gpt-oss-120b on Cerebras.

Targets in server/lib/cerebras.ts, called from server/routes/games.routes.ts:
- generateTermMatches()    (~line 388, max_tokens 2048, temperature 0.6)
- generateTrivia()         (~line 441, max_tokens 4096, temperature 0.7)
- generateCrosswordWords() (~line 522, max_tokens 3072, temperature 0.6)

Requirements:
- Model constant from Prompt 0, reasoning_effort: 'low'.
- KEEP all three temperature values. gpt-oss supports them, and they are what produced the
  variety these games rely on.
- READ the Games section of CLAUDE.md before touching any prompt text. The difficulty lives in
  the DISTRACTORS, not the question. Three attempts to make questions harder produced, in
  order: invented facts, ungrammatical fragments, and subjectless stems naming no concept.
  Port the prompts FAITHFULLY. Change only the transport.
- Trivia's reading budget must stay two-sided — a word target, not a ceiling. Stated
  one-sided, the model collapsed advanced questions to "What is XSS?".
- Crossword: keep the "A-Z, 3-10 letters" and "NEVER abbreviate" rules tier-independent and
  adjacent to the tier'd answer line. crossword.ts needs at least 2 survivors and the route
  throws on an empty layout.
- Games READ mastery and never write it. Do not import server/lib/bkt.ts.
- GenerateGameContentSchema has no difficulty field and must not gain one.

Verify:
- npm run lint
- Generate all three game types at each of the three tiers using
  npx tsx scripts/set-test-mastery.ts <tier>, then reset.
- READ 10 generated trivia questions yourself and check for invented facts. That is the
  documented failure mode and no type-check catches it. gpt-oss is a different model family
  from llama, so this check matters MORE here, not less.
- Confirm the stored game_content row carries the server-derived difficulty and mastery_snapshot.
- Report wall-clock time per game type.
- SAVE one generated set per game type to "LearnSyncAI artifacts/" for comparison against Gemini.
```

---

## Prompt 4 — chatbot streaming

```
Read CLAUDE.md and "LearnSyncAI artifacts/MIGRATION_PROMPTS_CEREBRAS.md" first.
Prompts 0-3 are already done.

Migrate the RAG chatbot to gpt-oss-120b on Cerebras.

Target: streamChatCompletion() in server/lib/cerebras.ts (~line 589), called from
server/routes/chat.routes.ts.

This is the EASY case on this branch: Cerebras streams in the OpenAI format, exactly like Groq.
The chunk loop should need almost no change. If you are rewriting it, stop and re-check.

Requirements:
- Model constant from Prompt 0, reasoning_effort: 'low'. Reasoning is especially costly here
  because the student is watching the response appear.
- The SSE wire format must NOT change: data: {"token": "..."} per chunk, then
  data: {"done": true}, then res.end(). ResourcesTab.tsx parses exactly this and is the one
  documented exception to the "never use raw fetch" rule. Do not touch the client.
- Preserve both modes: 'rag' (match_count 8) and 'full' (all concepts of exactly ONE material).
  Cerebras allows 65k context against Groq's much smaller budget, so the >6000-token 413 guard
  can be relaxed — keep a limit and document the new number.
- Preserve the refusal path and the chatbot_logs write after the stream completes.
- Preserve the error path: if headers are already sent, emit
  data: {"error": "Stream interrupted"}.
- Keep history at the last 4 messages.
- chat.routes.ts must keep requireRole('student') on BOTH routes and must keep calling
  rejectInaccessibleMaterials() on the body's material_ids.

Verify:
- npm run lint
- Ask a real question in the deployed UI in rag mode; confirm tokens stream progressively.
- Ask a summary question in full mode against one material.
- Ask an off-topic question and confirm the refusal still streams.
- Confirm a chatbot_logs row is written.
- Report time to first token as experienced in the BROWSER. This is the number that motivated
  choosing Cerebras — record it precisely for the comparison.
```

---

## Prompt 5 — remove Groq and verify the whole system

```
Read CLAUDE.md and "LearnSyncAI artifacts/MIGRATION_PROMPTS_CEREBRAS.md" first.
Prompts 0-4 are done.

Finish the provider swap.

1. Confirm nothing references Groq any more:
   grep -rn "groq\|GROQ" server/ src/ --include=*.ts --include=*.tsx
2. Remove groq-sdk from package.json if it is no longer used, and update package-lock.json.
3. Remove GROQ_API_KEY from .env and .env.example, and TELL ME to remove it from Render and to
   add CEREBRAS_API_KEY there — I must do that in the dashboard myself.
4. Update CLAUDE.md and ARCHITECTURE.md. The "Adaptive test generation is on Groq, not Gemini"
   section and every Groq free-tier quota figure are now false. Replace them with the Cerebras
   facts (base URL, gpt-oss-120b, 5 RPM free / 1000 RPM Developer, 65k/131k context) and KEEP
   the historical note explaining why Groq was dropped: models decommissioned 17 June 2026 and
   the paid tier closed to new signups.
5. Record the reasoning_effort rule in CLAUDE.md next to the existing Gemini 3 thinking-tokens
   warning — they are the same trap and should be documented together.

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

**Assumptions.** Identical to the Gemini branch so the two are comparable: 33 concepts/material,
177 chars/concept ≈ 45 tokens, and a per-student fortnight of 6 adaptive tests, 3 flashcard deck
generations, 6 games, 30 chat messages.

| Workload | Calls | Input | Output |
|---|---|---|---|
| Adaptive tests | 300 | 0.60M | 0.75M |
| Flashcard questions | 150 | 0.39M | 0.15M |
| Trivia / crossword / matches | 300 | 0.32M | 0.36M |
| Chat | 1,500 | 1.65M | 0.45M |
| **Total (migrated work)** | | **~2.96M** | **~1.71M** |

**Pricing:** `gpt-oss-120b` on Cerebras Developer tier — **$0.35 / $0.75 per 1M**.

| | Cost |
|---|---|
| Input 2.96M × $0.35 | $1.04 |
| Output 1.71M × $0.75 | $1.28 |
| **Migrated work** | **~$2.30** |

**Unavoidable Gemini baseline, identical on both branches.** Free Recall, Feynman, concept extraction
and all embeddings stay on Gemini. Both cognitive features run at `ThinkingLevel.MEDIUM` deliberately,
and those thinking tokens bill at Gemini's output rate. Baseline ≈ **$12–13** for the fortnight.

### Cerebras total ≈ **$15** for the two-week study

---

## Side-by-side comparison

| | Gemini branch | Cerebras branch |
|---|---|---|
| Migrated-work cost | ~$7.30 | **~$2.30** |
| Shared Gemini baseline | ~$12–13 | ~$12–13 |
| **Study total** | **~$20** | **~$15** |
| Chat response time | ~1.9s typical, **but variable** | expected well under 1s |
| Generation speed | ~2s at MINIMAL thinking, spiked to 20s | ~3,000 tok/s |
| Migration size | 4 sites rewritten + new streaming code | transport swap |
| Providers to run | **1** | 2 |
| Free tier for development | 20 req/day per model | 5 req/min, 1M tokens/day |
| Biggest risk | forgetting `thinkingLevel` | Developer tier signups being closed |

> **Cost is not the deciding factor — the two differ by about $5 across the whole study.** Decide on
> speed, on how many providers you want to operate, and on whether Cerebras will actually sell you the
> Developer tier. Verify that last one before committing, because it is precisely what failed with Groq.

Treat every figure as ±2–3×. Real student behaviour is the dominant unknown, and chat volume is the
single most sensitive assumption in both estimates.
