# Feynman Technique — Implementation Reference

> **Status: built and working. One prompt change awaiting live re-test** (see §12).
> Last updated 30 July 2026.
> Read alongside [freeRecallImplementationPlan.md](./freeRecallImplementationPlan.md) — the two tabs
> share `cognitive.routes.ts`, `cognitiveShared.tsx` and the history endpoint, and §2, §6 and §13
> there apply here too.

---

## 1. What the feature does

A student picks materials, picks one or more concepts from them, and explains each **in their own
words as if teaching a 10-year-old**. The AI grades every explanation and returns structured coaching.

**Feynman never writes BKT mastery.** Paper Scope, p. 59. `bkt_mastery` has exactly one writer:
`practice.routes.ts:130`.

### ⚠️ Before anything else

- **`cognitive_logs.student_id` is `NOT NULL` with no default and no trigger.** Set it on every
  insert. See §2 of the Free Recall doc — this bug meant *zero* submissions ever saved, for weeks.
- **Every route enforces its own ownership.** `supabaseAdmin` bypasses RLS. See §6 of the Free Recall
  doc for the full pattern and what each hole leaked.

---

## 2. The central design decision: two independent scores

*Simple* and *correct* are independent properties. An explanation can be beautifully simple and
completely wrong, or technically flawless and useless to a child. Averaged into one number, both
failures hide.

| Axis | Question | Graded against |
|---|---|---|
| `accuracy_score` | Is what the student asserted **true**? | The concept's stored `definition` |
| `simplicity_score` | Does it suit a 10-year-old? | The audience rubric |

The prompt explicitly says *"Do not let one score drag the other."*

### This was tested and it holds

30 July, against real submissions:

| Input | Accuracy | Simplicity | Gap |
|---|---|---|---|
| Textbook-perfect, jargon-heavy Defense-in-depth | **95** | **25** | 70 pts |
| "Defense-in-depth means you make your password really long" | **15** | **90** | 75 pts |
| Heavy-jargon OSI model (7 jargon terms flagged) | **90** | **5** | 85 pts |
| Circular "Redundancy is when a system has redundancy" | **40** | **15** | — |

The scores separate in **both directions** — they don't merely spread, they swap which is high. There
is **no score-contamination problem.** An extended concern about this was investigated on 30 July and
**did not reproduce**; a theory that the "never below 30" rule was making the model too lenient was
**disproven** (it scored 15 without hesitation).

> Do not "fix" score contamination. It was looked for, deliberately, and is not there.

---

## 3. Why NOT embeddings

Free Recall asks *"did you cover the material?"* — a coverage question, which cosine similarity
answers. Feynman asks a different question, and cosine similarity **cannot** answer it:

- A student who **parrots the textbook verbatim** scores ~0.95 while completely failing the exercise.
- Cosine similarity is **blind to jargon** — it cannot tell whether a child could follow the text.
- Cosine similarity is **blind to misconceptions** — a fluent, confidently wrong explanation sits
  close to the correct one in vector space.

This endpoint never touches the `embedding` column, so none of the `parseVector()` / 3072-dim /
hubness caveats apply. Instead the concept's authoritative `definition` is injected into the prompt as
ground truth. **That grounding is what makes the accuracy score trustworthy** rather than a reflection
of the model's own memory of the topic.

---

## 4. The pipeline

```
Student picks material → POST /materials/concepts/batch → picks N concepts → writes each explanation
        ↓
POST /api/cognitive/feynman  { space_id, material_ids[], audience, explanations: [{concept_id, explanation}] }
        ↓
0. GUARDS  requireOwnedSpace() → 404 · rejectInaccessibleMaterials() → 403
        ↓
1. Zod (FeynmanEvaluationSchema) → 400
        ↓
2. Reject duplicate concept_ids → 400
        ↓
3. Look up authoritative term + definition, scoped .in('material_id', material_ids)
   → 400 if any submitted concept is not in the selected materials
        ↓
4. Load the LESSON GLOSSARY — every concept term of the selected materials (terms only)
        ↓
5. ONE grounded prompt: rubric + anchored accuracy bands + analogy rules + glossary
   + [{term, true_definition, student_explanation}] per concept
        ↓
6. generateJson(prompt, { temperature: 0 })    ← gemini-2.5-flash, auto-retry on 429/5xx
        ↓
7. COERCE — never trust the model's schema (§8)
        ↓
8. INSERT ONE ROW (student_id!, material_ids, mode 'feynman', concept_id null)
   similarity_score = mean accuracy as 0–1
        ↓
9. 201 { log_id, created_at, ...FeynmanFeedback }
```

One row per **submission**, not per concept. The per-concept breakdown lives inside `ai_feedback`.

---

## 5. The three pipeline steps from the paper

The paper (p. 85) specifies a three-step pipeline. All three now exist; two needed work.

### Step 1 — Jargon Check ✅ (fixed 30 July)

The paper says jargon is judged *"against the main glossary list extracted during the document upload
phase."* **That glossary existed but was never passed to the prompt** — the model was judging jargon
purely on its own sense of difficulty.

Now every concept term from the selected materials is injected as a `LESSON GLOSSARY` block, and the
prompt says any glossary term used without being unpacked **must** be flagged. It previously said only
to "give priority" to them, and "server" slipped through unflagged on an answer aimed at a 10-year-old
even though **"Web server" is literally in that lesson's glossary.**

Verified: the heavy-jargon OSI submission flagged all seven of *conceptual framework, hierarchical
abstraction layers, functional decomposition, network communication protocols, encapsulates, payload,
adjacent superior layer.*

### Step 2 — Analogy Verification ✅ (built 30 July — was entirely missing)

The paper promises the AI *"checks if the student used a helpful comparison or everyday story."* Before
30 July the system **only ever suggested one** (`analogy_idea`). Nothing recorded whether the student
used one, and nothing was shown to them about their own.

That mattered beyond the missing feature: the simplicity rubric tells the model to *reward* analogies,
so **using one already moved the score invisibly.** Students were being graded on a criterion they
were never told about.

Three fields now exist per concept:

| Field | Meaning |
|---|---|
| `analogy_used` | did their own text contain an everyday comparison? |
| `analogy_quote` | their comparison, in their own words |
| `analogy_idea` | a verdict on theirs, or one to try when there was none |

### Step 3 — Finding the Gaps ✅ (was already faithful)

Graded against the stored `definition`; accuracy 0–100; verdict Correct / Needs Improvement /
Incorrect; encouraging feedback that names factual errors. Verified: the wrong-answer submission
produced *"Defense-in-depth is about having many different layers of security, **not just one thing
like a strong password**"* — it named the error rather than softening it.

---

## 6. Analogy verification — the part most likely to be misunderstood

### It is enforced in code, not just in the prompt

A claimed analogy is rejected on **two independent grounds**:

1. **No quote.** The model asserted one without producing the student's words. Nothing to show,
   nothing to trust.
2. **The quote is built from the lesson's own vocabulary** → an in-domain example, not an everyday
   comparison. `analogyUsesLessonVocabulary()` at `cognitive.routes.ts:630`.

Why (2) exists: the prompt alone **did not hold**. Measured on 30 July, the model accepted

> *"Resilience is like when a server keeps running after a failure. For example, it's like a backup
> server taking over automatically."*

as an everyday comparison — `analogy_used: true`, quote and all. It says "like" twice, but it compares
**computers to computers**, and "Web server" is a glossary term in that very lesson. The prompt
already forbade in-domain examples. It was ignored.

When the backstop fires, `analogy_idea` is replaced with `IN_DOMAIN_ANALOGY_NOTE`. **This is not
cosmetic:** the model wrote its suggestion believing the comparison counted, so it reads as praise —
displaying that under a "No everyday comparison" heading would contradict itself on screen.

### ⚠️ It matches WHOLE glossary terms only — never their individual words

**Do not "improve" this by splitting multi-word terms.** It was tried on 30 July and rejected on
evidence. This material's glossary produces head nouns:

| Glossary term | Head noun | An analogy it would destroy |
|---|---|---|
| Web **pages** | pages | "like **pages** in a book" |
| HTTP/HTTPS **traffic** | traffic | "like **traffic** on a road" |
| Broken Access **Control** | control | "like a remote **control**" |
| Input **fields** | fields | "like **fields** on a farm" |
| Radio **waves** | waves | "like **waves** at the beach" |
| Electrical **signals** | signals | "like traffic **signals**" |

Those are exactly the everyday analogies the feature exists to reward. Word-level matching would make
the tab **actively worse**.

**The accepted consequence:** a comparison sharing only a head noun ("a backup server") is *not* caught
by the code. That case is the prompt's job. **A false rejection is the worse error** — the student is
then told to compare to everyday life when they already did.

### Implementation details that are easy to break

- **The concept's own name is excluded** via `selfReferentialForms()`. Without it,
  "Defense-in-depth is like a castle" would be rejected, because Defense-in-depth is itself a
  glossary term.
- **Plural tolerance strips only the trailing `s`.** Stripping `"es"` turns "Web pages" into
  `"web pag"`, which stops matching "web page" entirely. This was a real bug in the first attempt.
- **Terms under 4 characters are skipped** as too generic.
- Single-word glossary terms are safe to match: this material's are all unambiguously technical
  (*Hacker, Database, Encryption, Redundancy, Resilience, Clickjacking*).

**14/14 unit checks passed** against the real 74-term glossary, including the six head-noun analogies
above as explicit regression cases.

---

## 7. The accuracy scale (anchored bands)

The first version gave the model no scale anchors, and the result was incoherent: a **circular but
true** CSRF explanation scored **0**, while a **true but mechanism-free** File Inclusion explanation
scored **90**. Worse, a hollow answer scored identically to a confidently false one — a student could
not tell whether they had said *nothing* or said something *wrong*. Those demand opposite remedies.

| Band | Meaning |
|---|---|
| **0–20** | **ASSERTS something FALSE** — different concept, reversed cause and effect, contradicts the definition |
| **30–50** | **TRUE but hollow** — restates the term, circular, names it without any mechanism |
| **55–75** | **TRUE with real mechanism**, but an essential step is missing |
| **80–100** | Accurate **and** covers the essential mechanism |

> **The critical instruction:** *"An explanation that says too little is NOT the same as an explanation
> that says something wrong. Never score below 30 unless you can quote the specific false statement
> the student made. Vagueness, circularity and omission are capped at 50 — they are not zeros."*

Verified: the circular Redundancy answer scored **40 twice, in two separate submissions.** The
wrong-concept answer scored **15**, having quoted the false statement — the rule permits going below
30 exactly when the model can point at the error, and it did.

---

## 8. Verdict is derived, never requested

`deriveVerdict()` computes it in TypeScript from `accuracy_score`:

| Accuracy | Verdict |
|---|---|
| ≥ 80 | `correct` |
| 30–79 | `needs_improvement` |
| < 30 | `incorrect` |

**Why:** asked for a verdict directly, the model **leaked the simplicity axis into it** — a
jargon-heavy but flawless Physical Layer explanation returned `needs_improvement` on an accuracy of
**100**, putting an amber badge above a perfect score. A `coerceVerdict()` fallback did not catch it,
because `needs_improvement` is *syntactically valid*.

**The lesson: never ask a model for a value you can compute deterministically from a number it already
gave you.** The prompt no longer requests the field.

### 🔶 OPEN DESIGN QUESTION — the verdict ignores simplicity

Because the verdict comes from accuracy alone, an explanation scoring **accuracy 95 / simplicity 25**
displays **"Correct"** — telling a student they succeeded at an exercise whose entire point is
explaining simply, when a 10-year-old could not follow a word.

**The user (30 July) said they want simplicity to count**, and I agree. The intended shape:

| Verdict | Rule |
|---|---|
| Correct | accuracy ≥ 80 **and** simplicity ≥ 60 |
| Needs Improvement | nothing false, but unclear or incomplete |
| Incorrect | accuracy < 30 |

**Not implemented.** Two reasons to be careful: it must stay a **code-side rule** (never ask the model
— see above), and **the paper needs a sentence added**, because p. 85 currently ties the verdict to
accuracy alone. Do not ship it without the paper edit.

---

## 9. Defensive coercion — model output is untrusted

| Helper | Purpose |
|---|---|
| `clampScore()` | 0–100 integer; non-finite → 0 |
| `deriveVerdict()` | verdict from accuracy; never reads the model's |
| `coerceStringArray()` | filters `jargon_found` to non-empty strings |
| `selfReferentialForms()` | every way the student might name the concept |
| `stripSelfReferentialJargon()` | removes the concept's own name from its jargon list |
| `analogyUsesLessonVocabulary()` | rejects in-domain "analogies" (§6) |
| `mean()` | per-concept → submission-level scores |

Per-concept results match on the **echoed `concept_id`**, with **positional order as fallback** — in
testing the model returned concepts in a different order than the prompt listed them, and ID matching
absorbed it silently.

**This layer is why a model swap can't corrupt the response shape** — only its judgement. Worth
knowing if the Groq question (§12) is revisited.

### `stripSelfReferentialJargon()`

When an explanation is circular the model flags the concept's own name as jargon — but the student was
*asked* to explain that term. CSRF's list came back as `["Cross-Site Request Forgery", "CSRF"]`. For
`"Cross-Site Request Forgery (CSRF)"` it now forbids the full term, the parenthetical-stripped form,
and the acronym. It correctly **keeps** `"OSI reference model"` on a Physical Layer explanation,
because that is the student's own phrasing, not the concept's title.

---

## 10. Audience — one value, deliberately still an enum

`FEYNMAN_AUDIENCES = ['10yr_old']` in `server/types/api.ts`.

A second audience, `self` ("Myself"), existed until 30 July with a rubric that **explicitly permitted
technical vocabulary** — meaning a student could use the Feynman tab without ever explaining anything
simply. The paper says the audience is "a 10-year-old child", full stop. **The user chose to remove it**
rather than document it.

It is kept as a **single-value enum** rather than deleted: every stored `ai_feedback` records which
rubric graded it, so adding an audience later is one rubric plus one array entry, not a data migration.
The dropdown is gone from the UI; the frontend sends the constant `AUDIENCE`.

⚠️ `audience: 'self'` now returns **400**. Any old client or saved payload sending it will fail.

---

## 11. Voice — feedback speaks TO the student (fixed 30 July)

The overall feedback used to read *"**The student's** explanation for Defense-in-depth uses very simple
language…"* — a report **about** a student rather than a message **to** one, while the per-concept
feedback in the same response said *"**You** did a great job…"*. Two voices in one result.

**Cause:** the field instruction said *"2-3 sentences summarising the submission"*, which invites
third-person reporting, and the Feynman prompt had no equivalent of Free Recall's *"Speak to a Junior
High School student"* rule.

Both prompts now carry an explicit rule — address the student as "you"/"your", never "the student" —
reinforced on each individual field, with a worked example. Verified: *"Your explanation for
'Defense-in-depth' was fantastic!"*, and a `%the student%` scan over `ai_feedback` came back clean.

`analogy_idea` was impersonal too (*"A good analogy would be…"*) and is now phrased as an invitation
(*"Try comparing it to…"*).

> Existing rows keep their old wording — stored prose cannot be retroactively reworded.

---

## 12. Model choice: Gemini vs Groq — the open question

Currently **`gemini-2.5-flash`** via `generateJson()`, one call per submission, `temperature: 0`.

The user asked (30 July) about moving Feynman to Groq, correctly noting it needs **no embeddings** and
is therefore cleanly separable — unlike Free Recall, which depends on `gemini-embedding-001`.

**Arguments for staying on Gemini:**

- This is the hardest prompt in the codebase: two anti-correlated scores, a restraint rule, analogy
  classification, glossary-grounded jargon. A reasoning pass helps.
- The verdict leak (§8) is on record: **Gemini already failed** at keeping the axes apart when asked
  for a verdict directly. A less deliberative model is a risk.
- Feynman is the **one place a model's judgement becomes a number a student is told about
  themselves.** A plausible wrong score is invisible — unlike a bad trivia question you can eyeball.
- ⚠️ **Groq calls have no retry wrapper at all.** Gemini has `withRetry` + `GeminiUnavailableError`
  → 503. A Groq 429 throws raw. **Moving Feynman as-is would regress the 503 handling.** Add a Groq
  equivalent first — it would also benefit flashcards, trivia, crossword, term matching and the chatbot,
  none of which have it.

**Arguments for Groq:** substantially faster inference, and the free-tier quota is the real
constraint (§13). But note Groq's own token-per-minute ceiling — `CLAUDE.md` records Groq 413-ing above
~6000 tokens, and this prompt now carries the whole glossary.

**If it is ever swapped, the bar to clear** is the §2 table: jargon-heavy-correct must return a large
accuracy/simplicity gap, simple-but-wrong must return the gap inverted, and the circular answer must
land 30–50 rather than near 0. The coercion layer (§9) protects the shape; nothing protects the
judgement.

**Do not swap for latency without first** parallelising Free Recall's embeddings and setting a thinking
budget — both provider-agnostic, no revalidation, and likely larger wins. See §12 of the Free Recall doc.

---

## 13. Quota — read before any student testing

Measured free-tier limits for `gemini-2.5-flash`: **5 RPM / 250k TPM / 20 RPD.**

- Feynman = **1** request per submission. Free Recall = **2**.
- 20 RPD is **~10–20 submissions per day for the entire school.**
- At 5 RPM, three Free Recall submissions in a minute trips the limit, and `withRetry` then sleeps
  1s → 2s → 4s. **Testing sessions feel glacial for this reason, not because the model is slow.**

The paper plans **50 students over 2–4 weeks**. **Enable billing before student testing.** Billing
raises limits; it does **not** speed up inference, though it does remove the backoff stalls.

⚠️ **Quota exhaustion presents as a code bug.** A 503 "AI service unavailable" is usually Google, not
you. Probe directly before debugging — a one-line `generateContent` call returns
`429 ... limit: 20, model: gemini-2.5-flash`.

---

## 14. API contract

### `POST /api/cognitive/feynman`

```jsonc
// request — FeynmanEvaluationSchema. `audience` defaults to '10yr_old' and only accepts that value.
{
  "space_id": "uuid",
  "material_ids": ["uuid"],
  "audience": "10yr_old",
  "explanations": [{ "concept_id": "uuid", "explanation": "at least 10 characters" }]
}
```

```jsonc
// 201 — FeynmanFeedback, also what lands in ai_feedback
{ "data": {
    "log_id": "uuid",
    "created_at": "...",
    "audience": "10yr_old",
    "accuracy_score": 68,          // mean across concepts
    "simplicity_score": 55,        // mean across concepts
    "overall_feedback": "Your explanation for 'Defense-in-depth' was fantastic! ...",
    "jargon_found": ["..."],       // union across concepts
    "concepts": [{
      "concept_id": "uuid",
      "term": "Defense-in-depth",
      "accuracy_score": 95,
      "simplicity_score": 95,
      "verdict": "correct",
      "jargon_found": [],
      "feedback": "You did a great job ...",
      "analogy_used": true,                                   // ← added 30 July
      "analogy_quote": "Like locking your door and also having a fence.",
      "analogy_idea": "..."
    }]
} }
```

| Status | Cause |
|---|---|
| 400 | Zod failure; duplicate `concept_id`; concept not in the selected materials; `audience: 'self'` |
| 401 | Not authenticated |
| 403 | A material id the caller may not read |
| 404 | Space not found **or not owned by the caller** |
| 503 | Gemini overloaded after retries |
| 500 | DB insert or unexpected failure |

Concepts for the picker come from **`POST /api/materials/concepts/batch`**, which was already correctly
gated by `rejectInaccessibleMaterials` — it was the only endpoint in this feature area that was.

History: `GET /api/cognitive/history/:spaceId?mode=feynman`. Scoped to the caller. Without `?mode` it
returns `free_recall` rows.

---

## 15. Storage — no migration needed

| Column | Value | Note |
|---|---|---|
| `student_id` | the caller | **NOT NULL** |
| `space_id` | the space | NOT NULL |
| `material_ids` | what was graded | Never populated before 30 July |
| `mode` | `'feynman'` | `cognitive_mode` enum |
| `concept_id` | `null` | A submission spans several concepts |
| `similarity_score` | mean accuracy as 0–1 | **A misnomer here** — inherited from Free Recall; nothing is compared by similarity |
| `ai_feedback` | `JSON.stringify(FeynmanFeedback)` | JSON **string**, not `jsonb` |

⚠️ **Treat every key in `ai_feedback` as optional.** `analogy_used` and `analogy_quote` do not exist on
rows written before 30 July. `FeynmanTab.tsx` checks `c.analogy_used === undefined` and falls back to
showing the suggestion alone. Keep that check.

---

## 16. Frontend

`src/pages/student/studySpaceTabs/FeynmanTab.tsx` (562 lines), layout from `cognitiveShared.tsx`
(318 lines), which is shared with Free Recall and **used by these two tabs only** — it is not part of
the global design system.

**Study / History toggle in the header. Submitting keeps you in Study.** `resultLogId` and
`historyLogId` are tracked separately; both views render through the same
`resultView(log, feedback, showWriteAnother)` helper. A slide-over "Past attempts" panel was built and
then **removed at the user's request (30 July) — do not reintroduce it.**

Result order: verdict banner → overall feedback → per-concept breakdown → collapsed own explanation.

**Accuracy is the ring; Simplicity is a secondary bar.** Previously two equal 88px rings sat side by
side, giving no clue that only accuracy drives the verdict.

Other behaviour worth preserving:

| Thing | Why |
|---|---|
| `explanations` keyed by `concept_id`, not term | What enables server-side grounding |
| Evaluate disabled until every concept has ≥ 10 chars | Matches the Zod `min(10)`; shows *"N concepts still need an explanation"* instead of provoking a 400 |
| Any error starting with `{` replaced with a generic retry message | Second line of defence against leaking an upstream payload |
| `parseFeedback()` returns `null` on malformed JSON | Renders an "could not be read" panel rather than crashing |
| Empty state distinguishes three cases | No material / still processing / none picked |

`src/lib/api.ts` is a **`fetch` wrapper** (not axios, whatever older docs said) that unwraps `{ data }`.

---

## 17. Known issues NOT fixed

1. **🔶 The verdict ignores simplicity.** See §8. Decided in principle, not implemented, needs a paper edit.

2. **`analogy_used` for head-noun in-domain comparisons ("a backup server")** is left to the prompt, not
   the code. Deliberate — see §6. **The sharpened prompt has NOT yet been re-tested live** (quota
   exhausted 30 July). This is the top item to verify next session; see §18.

3. **`similarity_score` is a misnomer** on Feynman rows.

4. **`stripSelfReferentialJargon()` over-strips slightly.** For `"Physical Layer (OSI Model)"` it removes
   a literal `"OSI Model"` chip, which arguably *is* jargon to a child. Accepted: the parenthetical is a
   disambiguator, not a claim the student made.

5. **Defense-in-Depth has scored 50–65 across runs** where arguably it is hollow name-dropping belonging
   in 30–50. Left alone: the student *did* assert the true core claim, and a simplicity score of 20–30
   already punishes buzzword-stuffing. Tightening risks pushing genuinely partial answers into "wrong".

6. **Nothing writes `activity_logs`** — Feynman sessions do not count toward streaks or study hours.
   Affects all five tabs. See §12.4 of the Free Recall doc.

7. **Multi-concept submissions are not in the paper.** The paper implies one concept per attempt; the code
   grades several and stores the mean. Needs a paper sentence, or leave as an undocumented extra.

8. **`simplicity_score` is not in the paper either.** An entire second 0–100 axis the paper never mentions.
   Same choice: document it or remove it. **Recommend documenting** — it is the better design.

---

## 18. ▶ Next session: re-test the analogy fix

The prompt change in §6 is **unverified against the live model** — quota ran out on 30 July. Verify
first, before anything else.

**One submission, four concepts, one API call:**

| Concept | Paste | Must return |
|---|---|---|
| Resilience | *Resilience is like when a server keeps running after a failure. For example, it's like a backup server taking over automatically.* | **No** everyday comparison; `server` flagged as jargon |
| Physical Layer | *The physical layer is like pages in a book, where each page has its own job and you read them in order.* | Comparison **used** ✓ |
| Redundancy | *Redundancy is like carrying a spare tyre in your car, so if one goes flat you can still drive home.* | Comparison **used** ✓ |
| Network Layer | *The network layer is like the OSI model deciding where all the pieces need to go.* | **No** comparison — caught by the code backstop |

Rows 2 and 3 are the **regression guard**: row 2 shares the word "pages" with the glossary term
"Web pages" and must still be accepted. **If row 2 is rejected, the backstop is over-matching and good
analogies are being destroyed.**

Then a second submission for the bands: wrong-concept → 10–20, partially-correct → 55–75,
circular → 30–50.

Inspect with:

```sql
select to_char(l.created_at,'HH24:MI') as t, c->>'term' as term,
       c->>'accuracy_score' as acc, c->>'simplicity_score' as simp,
       c->>'verdict' as verdict, c->>'analogy_used' as analogy_used,
       left(c->>'analogy_quote',70) as quote, c->>'jargon_found' as jargon
from cognitive_logs l, json_array_elements(l.ai_feedback::json->'concepts') c
where l.mode='feynman' order by l.created_at desc;
```

⚠️ **Bundled submissions hide everything in the averages** — always expand `concepts` like this. The
top-level `accuracy_score` is a mean and told us nothing during the 30 July run.

---

## 19. Verification history

No test suite exists (`npm run lint` is `tsc --noEmit`; no `npm test`). See §13 of the Free Recall doc
for the harness traps — especially `profiles.first_name`/`last_name` being `NOT NULL` and failing
silently, and stale servers holding port 5000.

Passed 30 July 2026:

- **28/28** security + `student_id`, shared with Free Recall.
- **Axis independence**, live: the four-row table in §2.
- **Anchored bands**, live: circular Redundancy = 40 twice; wrong-concept = 15 with the error quoted.
- **Jargon**, live: 7/7 terms on the heavy-jargon OSI submission.
- **Voice**, live: second person throughout; `%the student%` scan clean.
- **Multi-concept**, live: 95/95 and 40/15 in one submission, mean 68 matching the stored value.
- **14/14** analogy backstop, offline against the real 74-term glossary, including six head-noun
  regression cases.
- **Analogy detection**, live: castle analogy correctly `true` with the quote returned.

Failed and fixed: the fake-analogy case (§6) — **fix not yet re-tested live.**

---

## 20. Related documents

- [freeRecallImplementationPlan.md](./freeRecallImplementationPlan.md) — sibling tab; §2 (the
  `student_id` trap), §6 (security), §13 (harness traps) apply here too
- [STUDENT_RESOURCES_IMPLEMENTATION.md](./STUDENT_RESOURCES_IMPLEMENTATION.md) — `materialAccess.ts`
  and the access-control model
- `ARCHITECTURE.md` §6 — the algorithm of record, including the analogy backstop rationale
- `CLAUDE.md` — "Cognitive Tabs" section and the non-negotiable rules
- Paper pp. 58–59 (Scope, the BKT restriction) and p. 85 (the three-step pipeline)
