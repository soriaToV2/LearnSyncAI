# LearnSync AI — Database Schema Explained

A plain-language walkthrough of every table, enum, function, view, trigger, and security
rule in [`schema.sql`](../schema.sql).

This document assumes **no prior database knowledge**. If you know SQL already, skip to
[Part 3](#part-3--the-enums-fixed-choice-lists).

- **Database:** Supabase (PostgreSQL 17) + the `pgvector` extension
- **Contents:** 9 enums · 21 tables · 2 views · 11 functions · 6 triggers · 37 security policies
- **Source of truth:** [`schema.sql`](../schema.sql). Changes are applied through numbered files in `supabase/migrations/`.

---

## Table of Contents

1. [The big picture](#part-1--the-big-picture)
2. [Building blocks you need to know](#part-2--building-blocks-you-need-to-know)
3. [The enums (fixed choice lists)](#part-3--the-enums-fixed-choice-lists)
4. [People and permissions](#part-4--people-and-permissions)
5. [Subjects](#part-5--subjects)
6. [Study spaces](#part-6--study-spaces)
7. [Materials and concepts](#part-7--materials-and-concepts)
8. [Flashcards and spaced repetition](#part-8--flashcards-and-spaced-repetition)
9. [Free Recall and the Feynman Technique](#part-9--free-recall-and-the-feynman-technique)
10. [The AI chatbot](#part-10--the-ai-chatbot)
11. [Adaptive Test Mode](#part-11--adaptive-test-mode)
12. [Bayesian Knowledge Tracing (BKT)](#part-12--bayesian-knowledge-tracing-bkt)
13. [Activity, streaks, and games](#part-13--activity-streaks-and-games)
14. [Views (pre-built reports)](#part-14--views-pre-built-reports)
15. [Functions](#part-15--functions)
16. [Triggers (automatic reactions)](#part-16--triggers-automatic-reactions)
17. [Row-Level Security](#part-17--row-level-security)
18. [File storage](#part-18--file-storage)
19. [Quick reference](#part-19--quick-reference)

---

## Part 1 — The big picture

### The story the database tells

```
An ADMIN creates accounts.
      │
      ▼
An EDUCATOR uploads a PDF, choosing its  ─────►  materials
      │  subject and which grades may see it       (subject + grade_levels, e.g. {7,8})
      ▼
AI reads the PDF and pulls out key terms  ────►  concepts  (+ a "meaning fingerprint")
      │
      ▼
A STUDENT creates a study space  ─────────────►  study_spaces
      │  and picks which materials to use  ────►  study_space_materials
      ▼
The student studies in five ways:
      ├── Flashcards      ──►  flashcards, spaced_repetition_logs   ◄── updates mastery
      ├── Adaptive Test   ──►  practice_tests, practice_telemetry   ◄── updates mastery
      ├── Free Recall     ──►  cognitive_logs                        (feedback only)
      ├── Feynman         ──►  cognitive_logs                        (feedback only)
      └── AI Chatbot      ──►  chatbot_logs                          (feedback only)
      │
      ▼
Every study action is logged  ─────────────────►  activity_logs
      │                                            └──► streaks & study hours
      ▼
Mastery per concept is tracked  ───────────────►  bkt_mastery  (+ bkt_update_logs audit trail)
      │
      ├──► Games get harder or easier based on it   (games never change it)
      ├──► The student sees a progress bar
      └──► The educator sees a class dashboard
```

### The one rule that matters most

> **Only two activities can change a student's mastery score: Adaptive Flashcards and
> Adaptive Test Mode.**
>
> Games, Free Recall, the Feynman Technique, and the chatbot all *read* mastery to
> personalise themselves, but they never *write* to it.

This rule comes straight from the research paper and is the reason `bkt_source` only has
two possible values.

### The three roles

| Role | What they do | What they cannot do |
| :--- | :--- | :--- |
| **admin** | Create, edit, and disable accounts. Set a student's grade level, reset a forgotten password, repair an account that cannot sign in. | Touch learning content or analytics. Delete an account. Create another admin. |
| **educator** | Upload PDFs for their subjects, choosing which grades may access each one. Watch those students' progress. | See a student's private study spaces, flashcards, essays, or chat history. |
| **student** | Study, take tests, play games. | See anyone else's data at all. |

---

## Part 2 — Building blocks you need to know

Skip this if you already know SQL.

### What a table is

A table is a spreadsheet. **Columns** are the headings; **rows** are the entries.

### Data types used in this schema

| Type | Plain meaning | Example |
| :--- | :--- | :--- |
| `UUID` | A long random ID that is guaranteed never to repeat. Used instead of 1, 2, 3 so IDs can't be guessed. | `0c4ea02a-1711-4ca6-95f5-…` |
| `TEXT` | Any text, any length. | `'Photosynthesis'` |
| `SMALLINT` / `INTEGER` / `BIGINT` | Whole numbers, small to large. | `7`, `1500`, `20971520` |
| `NUMERIC` | Exact decimal number. Used for probabilities so there's no rounding drift. | `0.6200` |
| `BOOLEAN` | True or false. | `true` |
| `TIMESTAMPTZ` | A moment in time, including the timezone. | `2026-07-23 14:05+08` |
| `DATE` | A calendar day only, no clock time. | `2026-07-23` |
| `JSONB` | A whole structured document stored in one cell. Used when the shape varies. | `{"questions": [...]}` |
| `UUID[]` / `SMALLINT[]` | An **array** — a list inside one cell. | `{7,8,9,10}` |
| `vector(3072)` | A list of 3,072 numbers describing the *meaning* of a piece of text. | `[-0.013, 0.024, …]` |

### Rules you'll see attached to columns

| Rule | Plain meaning |
| :--- | :--- |
| `PRIMARY KEY` | The unique identifier for a row. No duplicates, never empty. |
| `NOT NULL` | This cell can't be left blank. |
| `DEFAULT x` | If nothing is provided, use `x`. |
| `UNIQUE` | No two rows may share this value. |
| `CHECK (...)` | A condition that must always be true, or the save is rejected. |
| `REFERENCES other(col)` | A **foreign key** — this value must exist in another table. Stops orphaned data. |

### What happens when a parent row is deleted

This is the `ON DELETE` part of a foreign key, and it matters a lot:

| Setting | What happens | Where we use it |
| :--- | :--- | :--- |
| `CASCADE` | Delete the children too. | Delete a student → their study spaces, flashcards, and logs all go. |
| `SET NULL` | Keep the child, just blank the link. | Delete a concept → the flashcard survives, it just no longer points anywhere. |
| `RESTRICT` | Block the delete entirely. | You cannot delete an educator who still has materials. |

### What an index is

An index is the alphabetical tab section of a filing cabinet. Without one, the database
reads every row to find a match. With one, it jumps straight there. Indexes make reads
faster and writes very slightly slower — worth it on any column you search or join by.

### What a function, view, and trigger are

- **Function** — a saved calculation you can call by name, like a formula in Excel.
- **View** — a saved question. It looks like a table but stores nothing; it re-runs its
  query every time you look at it, so it's always current.
- **Trigger** — an automatic reaction. "Whenever a row is added here, also do this."
  The application doesn't have to remember; the database does it every time.

---

## Part 3 — The enums (fixed choice lists)

An **enum** is a drop-down list defined at the database level. If a value isn't on the
list, the database refuses to save it. This prevents typos like `'Studnet'` or
`'multiple choice'` vs `'multiple_choice'` from ever entering the data.

### 1. `user_role`
```
'student' | 'educator' | 'admin'
```
Who someone is. Everything about permissions flows from this.

### 2. `account_status`
```
'active' | 'disabled'
```
Lets an admin switch off an account (a student who left the school) without deleting it
and losing their learning history. A `disabled` account fails every permission check.

### 3. `parsed_status`
```
'pending' | 'processing' | 'completed' | 'failed'
```
How far along the AI is in reading an uploaded PDF.

| Value | Meaning |
| :--- | :--- |
| `pending` | Uploaded, waiting in line. |
| `processing` | The AI is reading it right now. |
| `completed` | Done — concepts extracted, the material is usable. |
| `failed` | Something went wrong. The reason is stored in `materials.parse_error`. |

### 4. `practice_status`
```
'in_progress' | 'completed'
```
Whether a practice test is still being taken or has been submitted. `in_progress` lets a
student pause and resume later.

### 5. `cognitive_mode`
```
'free_recall' | 'feynman'
```
Which of the two writing exercises a submission belongs to.

### 6. `game_type`
```
'term_matcher' | 'crossword' | 'timed_trivia'
```
The three PlayMe games.

### 7. `question_type`
```
'multiple_choice' | 'identification' | 'matching_type' | 'fill_in_the_blank' | 'true_or_false'
```
The five test formats a student can choose. **This is not just labelling** — the format
determines how much credit a correct answer earns, because guessing a 50/50 true-or-false
question proves far less than recalling a term from memory. See
[Part 12](#part-12--bayesian-knowledge-tracing-bkt).

### 8. `bkt_source`
```
'flashcard' | 'adaptive_test'
```
The only two activities allowed to change a mastery score. Having just two values here
enforces the paper's rule at the database level.

### 9. `activity_type`
```
'flashcard' | 'free_recall' | 'feynman' | 'adaptive_test' | 'game' | 'chat'
```
What kind of studying an activity log entry records. Used for streaks and study hours.

---

## Part 4 — People and permissions

### `profiles`

Everyone who uses the platform. Supabase keeps passwords and emails in its own private
`auth.users` table; `profiles` holds everything *we* care about, linked by the same ID.

| Column | Type | What it's for |
| :--- | :--- | :--- |
| `id` | UUID (PK) | Same ID as the login account. |
| `role` | user_role | student / educator / admin. Default `student`. |
| `first_name`, `last_name` | TEXT | Display name. |
| `grade_level` | SMALLINT | **Students only.** 7–10. Blank for educators and admins. |
| `status` | account_status | `active` or `disabled`. |
| `created_at`, `updated_at` | TIMESTAMPTZ | When created / last edited. |

**The rules:**

- `profiles_grade_level_range` — a grade must be 7, 8, 9, or 10 if present.
- `profiles_student_needs_grade` — **a student must have a grade level.** Without one they
  couldn't be matched to any material, so a student row without a grade is simply invalid.

**Why educators have no grade column here.** You might expect a matching
`assigned_grade_levels` list. There used to be one, and it was removed on purpose — an
educator's grades are not a fixed property of the person. The educator decides, **per
material**, which grades may access it, and that lives in `materials.grade_levels`. The
grades an educator can *monitor* are then calculated from the materials they published, by
`private.auth_assigned_grades()`. One source of truth, so what a teacher can see can never
drift from what they actually shared.

**Indexes:** `idx_profiles_role_grade` on `(role, grade_level)` — the exact lookup used to
answer "who are the Grade 8 students?"

---

## Part 5 — Subjects

### `subjects`

The official list of subjects taught at PCA.

| Column | Type | What it's for |
| :--- | :--- | :--- |
| `code` | TEXT (PK) | Short code, e.g. `SCI`. |
| `name` | TEXT | Full name, e.g. `Science`. |
| `sort_order` | SMALLINT | Display order in dropdowns. |

Seeded with the DepEd Junior High School core subjects plus Christian Living:

| Code | Subject |
| :--- | :--- |
| `FIL` | Filipino |
| `ENG` | English |
| `MATH` | Mathematics |
| `SCI` | Science |
| `AP` | Araling Panlipunan |
| `ESP` | Edukasyon sa Pagpapakatao |
| `TLE` | Technology and Livelihood Education |
| `MAPEH` | Music, Arts, Physical Education and Health |
| `CL` | Christian Living |

**Why a table instead of just typing the subject?** If teachers type it freely you get
`Science`, `science`, `Sci`, and `Sciene` — and the educator dashboard treats them as four
different subjects. A fixed list makes grouping and filtering reliable.

### There is no teaching-assignment table

Educators are **not** pre-assigned to subjects or grade levels. There is nothing an admin has
to set up before a teacher can upload — a new educator account can publish the moment it
exists.

When uploading a material the educator chooses:

- **the subject**, any entry from the catalogue above → stored in `materials.subject`
- **the grade levels** that may access it, any of 7–10 → stored in `materials.grade_levels`

**Why no restriction?** A teacher does not upload a Mathematics module when they teach
Filipino — the real classroom already settles that. Encoding it in the database bought no
safety and cost a mandatory admin step that left every new account inert until someone
remembered it. It also went beyond the specification, which scopes the admin to "creating,
editing, disabling accounts" and gives grade-level access control to the educator.

**What this means downstream.** The grades a teacher can monitor are worked out from the
materials they published, by `private.auth_assigned_grades()`. Publish a Science module to
Grades 7 and 8 and those students appear on your dashboard; publish nothing and you see
nobody.

> An earlier version of this schema had an `educator_assignments` table holding
> subject/grade pairs, enforced by an `enforce_material_publish_scope()` trigger. Both were
> removed. If you find references to either in older notes, they no longer exist.

---

## Part 6 — Study spaces

### `study_spaces`

A student's personal study folder. Each one holds the five study tabs: Flashcards, Free
Recall, Feynman, Test Mode, and Course Resources.

| Column | Type | What it's for |
| :--- | :--- | :--- |
| `id` | UUID (PK) | The space's ID. |
| `student_id` | UUID | Who owns it. Delete the student → the space goes too. |
| `title` | TEXT | e.g. "Science — Quarter 1". |
| `description` | TEXT | Optional note. |
| `created_at`, `updated_at` | TIMESTAMPTZ | Timestamps. |

Study spaces are **completely private**. No educator, no classmate, nobody. An earlier
version of the platform had a "CollabShare" feature for sharing spaces between students; it
was removed because it appears nowhere in the version-4 documentation and it contradicted
the promise that students' data is isolated from one another.

### `study_space_materials`

The link between a study space and the educator materials it uses. This is a **join
table** — it exists purely to connect two other tables in a many-to-many relationship:
one material can appear in many students' spaces, and one space can pull in many materials.

| Column | Type | What it's for |
| :--- | :--- | :--- |
| `space_id` | UUID | Which study space. |
| `material_id` | UUID | Which material. |
| `added_at` | TIMESTAMPTZ | When the student added it. |

Adding a material here does **not** grant access to it. The student still has to be in a
grade the material was published to — checked separately every time.

---

## Part 7 — Materials and concepts

### `materials`

An educator-uploaded PDF. **Students can never upload here** — the whole point is that all
AI-generated content traces back to teacher-approved sources.

| Column | Type | What it's for |
| :--- | :--- | :--- |
| `id` | UUID (PK) | The material's ID. |
| `educator_id` | UUID | Who uploaded it. `RESTRICT` — see below. |
| `title` | TEXT | Display name. |
| `description` | TEXT | Optional summary. |
| `subject` | TEXT | Which subject (from `subjects`). Required. |
| `grade_levels` | SMALLINT[] | **Which grades may access it**, e.g. `{7,8}`. The educator picks this at upload. |
| `storage_path` | TEXT | Where the actual PDF file sits in storage. |
| `file_size_bytes` | BIGINT | File size. |
| `page_count` | INTEGER | Number of pages. |
| `is_scanned` | BOOLEAN | True for photographed/scanned PDFs. |
| `parsed_status` | parsed_status | How the AI extraction is going. |
| `parse_error` | TEXT | Why it failed, if it did. |
| `is_archived` | BOOLEAN | Hidden from students without being deleted. |
| `created_at`, `updated_at` | TIMESTAMPTZ | Timestamps. |

**`grade_levels` is the heart of access control.** A material with `{7,8}` is visible to
every Grade 7 and Grade 8 student and invisible to Grades 9 and 10 — not hidden in the
interface, but genuinely unreadable at the database level.

It is also the *only* place grade access is decided. The educator chooses these grades when
uploading and can change them later, and the same column decides which students show up on
that educator's analytics dashboard.

**The rules, and why each exists:**

| Rule | What it enforces | Why |
| :--- | :--- | :--- |
| `materials_grade_levels_valid` | Grades must be from `{7,8,9,10}` and at least one is required. | A material visible to nobody is pointless; grade 11 doesn't exist at JHS. |
| `materials_file_size_limit` | ≤ 20,971,520 bytes (20 MB). | The documented upload limit, enforced in the database so no code path can bypass it. |
| `materials_scanned_page_limit` | Scanned PDFs ≤ 20 pages. | The documented limit for image-based PDFs, which are far more expensive to process. |
| `materials_page_count_positive` | Page count > 0 if given. | A zero-page PDF is a broken upload. |

**Why `educator_id` uses `RESTRICT`:** if a teacher's account is deleted, the database
*refuses* rather than silently destroying every material they uploaded and every student's
mastery record attached to it. You must reassign or archive the materials first — a
deliberate speed bump on an irreversible action.

**Indexes:** by educator, by subject, by grade (`GIN`, the index type built for searching
inside arrays), and by status for materials still being processed.

### `concepts`

The key terms the AI pulled out of a material. This is the platform's knowledge base —
flashcards, test questions, game clues, and chatbot answers all come from here.

| Column | Type | What it's for |
| :--- | :--- | :--- |
| `id` | UUID (PK) | The concept's ID. |
| `material_id` | UUID | Which PDF it came from. |
| `term` | TEXT | The term, e.g. "Photosynthesis". |
| `definition` | TEXT | Its explanation. |
| `embedding` | vector(3072) | A "meaning fingerprint" — see below. |
| `parent_concept_id` | UUID | Optional link to a broader concept. |
| `created_at` | TIMESTAMPTZ | When extracted. |

**What an embedding actually is.** Google's `gemini-embedding-001` model turns a piece of
text into 3,072 numbers that describe its *meaning*. Texts that mean similar things get
similar numbers — even with no words in common. That's how the system knows a student who
wrote "plants make food from sunlight" understood photosynthesis, without matching a single
keyword.

> ⚠️ **Never change the embedding model.** All 3,072-number fingerprints must come from the
> same model to be comparable. Switching models makes every stored vector meaningless and
> would require re-processing every material.

**Why there's no search index on `embedding`:** PostgreSQL's fast vector indexes (HNSW,
IVFFlat) support at most 2,000 dimensions, and this model produces 3,072. Searches still
work correctly, they just scan every row. At the scale of one school's materials, that's
comfortably fast.

---

## Part 8 — Flashcards and spaced repetition

### `flashcard_decks`

A named group of cards inside a study space — "Chapter 2 Vocabulary".

| Column | Type | What it's for |
| :--- | :--- | :--- |
| `id` | UUID (PK) | Deck ID. |
| `space_id` | UUID | Which study space it belongs to. |
| `title`, `description` | TEXT | Name and optional note. |
| `created_at` | TIMESTAMPTZ | When created. |

### `flashcards`

| Column | Type | What it's for |
| :--- | :--- | :--- |
| `id` | UUID (PK) | Card ID. |
| `deck_id` | UUID | Which deck. |
| `term` | TEXT | Front of the card. |
| `definition` | TEXT | Back of the card. |
| `is_ai_generated` | BOOLEAN | AI-made or hand-written. |
| `concept_id` | UUID | **Which concept this card tests.** |
| `source_material_id` | UUID | Which PDF it came from. |
| `next_review_at` | TIMESTAMPTZ | When to show this card again. |
| `ease_rating` | TEXT | Last self-rating: `easy`, `medium`, or `hard`. |
| `created_at` | TIMESTAMPTZ | When created. |

**`concept_id` is the most important column here.** Without it, rating a card would have
nothing to update — the system would know you found *a card* easy, but not *which piece of
knowledge* you'd demonstrated. It's optional (`NULL`) because a student can hand-write a
card that doesn't correspond to any extracted concept; such cards simply don't move mastery.

### `spaced_repetition_logs`

A permanent record of every time a student rated a card.

| Column | Type | What it's for |
| :--- | :--- | :--- |
| `id` | UUID (PK) | Log ID. |
| `student_id` | UUID | Who reviewed. |
| `flashcard_id` | UUID | Which card. |
| `concept_id` | UUID | Which concept. |
| `rating` | TEXT | `easy`, `medium`, or `hard`. |
| `interval_days` | SMALLINT | Days until the next review: 1, 3, or 7. |
| `next_review_at` | TIMESTAMPTZ | The resulting due date. |
| `reviewed_at` | TIMESTAMPTZ | When it happened. |

**How one rating does two jobs.** This is the Leitner spaced-repetition system combined
with BKT:

| Student says | Scheduled again in | Counted as | Guess allowance P(G) |
| :--- | :--- | :--- | :--- |
| **Easy** | 7 days | Correct (1) | 0.05 — you clearly knew it |
| **Medium** | 3 days | Correct (1) | 0.25 — you might have half-guessed |
| **Hard** | 1 day | Incorrect (0) | 0.10 |

So rating a card both reschedules it *and* updates the mastery estimate for its concept.
The student sees a review schedule; the maths happens quietly underneath.

---

## Part 9 — Free Recall and the Feynman Technique

### `cognitive_logs`

Both writing exercises save here. Neither one changes mastery — they give feedback only.

| Column | Type | What it's for |
| :--- | :--- | :--- |
| `id` | UUID (PK) | Log ID. |
| `student_id` | UUID | Who submitted. |
| `space_id` | UUID | Which study space. |
| `concept_id` | UUID | Which concept, if it targeted just one. |
| `material_ids` | UUID[] | Which materials it was graded against. |
| `mode` | cognitive_mode | `free_recall` or `feynman`. |
| `user_input` | TEXT | What the student wrote. |
| `similarity_score` | NUMERIC | Free Recall coverage, 0 to 1. |
| `ai_feedback` | TEXT | The AI's response, stored as JSON text. |
| `created_at` | TIMESTAMPTZ | When submitted. |

**How Free Recall is scored — and why it isn't the obvious way.**

1. The student writes everything they remember, no notes.
2. Gemini pulls out the distinct ideas they actually mentioned.
3. Each idea gets its own meaning fingerprint.
4. Every reference concept is compared against all of them; the best match counts.
5. A concept is **Covered** if its best match scores ≥ 0.70, otherwise **Missed**.
6. `similarity_score = covered ÷ total`.

The obvious approach — average all the similarity scores — gives dishonestly high marks. In
3,072-dimensional space even completely unrelated texts score around 0.60–0.65 just by
chance (the "hubness" problem), so a blank-ish answer might average 0.62 and look like a
pass. Counting how many concepts were genuinely covered gives a score that means something.

**`ai_feedback` holds JSON as plain text**, so the application must run `JSON.parse()` on it
before use. For the Feynman Technique it contains the full three-step evaluation: jargon
flagged, whether an analogy was used, an accuracy score out of 100, and a verdict of
Correct / Needs Improvement / Incorrect.

---

## Part 10 — The AI chatbot

### `chatbot_logs`

Every question a student asked and the answer they got.

| Column | Type | What it's for |
| :--- | :--- | :--- |
| `id` | UUID (PK) | Log ID. |
| `student_id` | UUID | Who asked. |
| `space_id` | UUID | Which study space. |
| `message` | TEXT | The question. |
| `response` | TEXT | The AI's answer. |
| `material_ids` | UUID[] | Which materials were in scope. |
| `source_concept_ids` | UUID[] | Which concepts the answer drew on. |
| `mode` | TEXT | `rag` or `full`. |
| `created_at` | TIMESTAMPTZ | When. |

**The two modes:**

| Mode | How it works | Best for |
| :--- | :--- | :--- |
| `rag` | Finds the handful of most relevant concepts by meaning, sends only those to the AI. | Specific questions. |
| `full` | Sends *every* concept from **one** material. | Summaries and overviews. |

`full` is limited to a single material because sending more overflows the AI's input limit.

`source_concept_ids` is what makes answers auditable — you can check exactly which
teacher-approved definitions produced any given answer. The chatbot cannot draw on outside
knowledge.

---

## Part 11 — Adaptive Test Mode

### `practice_tests`

One generated practice test.

| Column | Type | What it's for |
| :--- | :--- | :--- |
| `id` | UUID (PK) | Test ID. |
| `student_id` | UUID | Who it's for. |
| `space_id` | UUID | Which study space. |
| `title` | TEXT | Test name. |
| `source_material_ids` | UUID[] | Which materials it covers. |
| `question_types` | question_type[] | Which formats the student chose. |
| `questions_payload` | JSONB | The generated questions. |
| `student_answers` | JSONB | Answers so far — allows pause and resume. |
| `score` | NUMERIC | Final score. |
| `difficulty_tier` | TEXT | `foundational`, `intermediate`, or `advanced`. |
| `mastery_snapshot` | NUMERIC | The mastery reading used to pick the tier. |
| `status` | practice_status | In progress or completed. |
| `created_at`, `completed_at` | TIMESTAMPTZ | Timestamps. |

**How difficulty adapts.** Before generating, the system checks the student's current
mastery and instructs the AI accordingly:

| Current mastery | Tier | What gets generated |
| :--- | :--- | :--- |
| Below 0.50 | `foundational` | Direct definitions, basic recall |
| 0.50 – 0.85 | `intermediate` | Comparisons, multi-concept recall, applications |
| 0.85 and above | `advanced` | Analysis, synthesis, edge cases |

`mastery_snapshot` records the exact number used, so afterwards you can verify the right
difficulty was chosen — one of the documented AI verification checks.

### `practice_telemetry`

One row per question answered.

| Column | Type | What it's for |
| :--- | :--- | :--- |
| `id` | UUID (PK) | Row ID. |
| `student_id` | UUID | Who answered. |
| `concept_id` | UUID | Which concept it tested. |
| `practice_test_id` | UUID | Which test. |
| `question_type` | question_type | Which format. |
| `question_index` | INTEGER | Position in the test. |
| `is_correct` | BOOLEAN | Right or wrong. |
| `latency_ms` | INTEGER | How long they took. |
| `created_at` | TIMESTAMPTZ | When. |

**`question_type` is required here for a mathematical reason,** not for reporting: it
determines the guess allowance applied to this answer. Getting a true-or-false question
right (50% chance of a lucky guess) has to count for much less than recalling a term from a
blank line (essentially no chance). Without knowing the format, the mastery update would be
wrong.

---

## Part 12 — Bayesian Knowledge Tracing (BKT)

BKT estimates **the probability that a student has truly learned a concept**, from 0.0 to
1.0. It's built directly into the backend — no external library, no machine-learning
training step.

### The four parameters

| Symbol | Name | Value | Plain meaning |
| :--- | :--- | :--- | :--- |
| **P(L₀)** | Initial knowledge | 0.10 | Assume a 10% chance they already knew it before starting. |
| **P(T)** | Learning rate | 0.20 | Each practice gives a 20% chance of moving from "doesn't know" to "knows". |
| **P(S)** | Slip | 0.15 | Even someone who knows it answers wrong 15% of the time — carelessness, fatigue, misreading. |
| **P(G)** | Guess | varies | Chance of answering right *without* knowing. Depends entirely on the format. |

### Why P(G) changes

Getting a true-or-false question right proves much less than writing a term from memory:

| Situation | P(G) | Reasoning |
| :--- | :--- | :--- |
| True or False | 0.50 | Two options — a coin flip. |
| Multiple choice (4 options) | 0.25 | One in four. |
| Matching type (4 terms, 6 definitions) | 0.17 | One in six. |
| Identification | 0.05 | No options given; guessing is near-impossible. |
| Fill in the blank | 0.05 | Same. |
| Flashcard rated *Easy* | 0.05 | High confidence it was genuine knowledge. |
| Flashcard rated *Medium* | 0.25 | Some chance of half-remembering. |
| Flashcard rated *Hard* | 0.10 | Counted as wrong; allows for vague partial recall. |

### The two-step update

Every answer triggers two calculations.

**Step 1 — Evidence.** Given what just happened, revise the estimate.

If correct:
```
P(L | correct) = P(L)·(1 − P(S)) ÷ [ P(L)·(1 − P(S)) + (1 − P(L))·P(G) ]
```
If incorrect:
```
P(L | incorrect) = P(L)·P(S) ÷ [ P(L)·P(S) + (1 − P(L))·(1 − P(G)) ]
```

**Step 2 — Transition.** Practising is itself a chance to learn, so add that in:
```
P(L next) = P(L | answer) + (1 − P(L | answer)) × P(T)
```

**Worked example** — three multiple-choice questions, starting at 0.10:

| Attempt | Result | After evidence | After transition |
| :--- | :--- | :--- | :--- |
| 1 | Correct | 0.27 | **0.42** |
| 2 | Correct | 0.71 | **0.77** |
| 3 | Incorrect | 0.40 | **0.52** |

Two right answers lifted mastery from 0.10 to 0.77. One wrong answer pulled it back to
0.52 — a real drop, but not a collapse, because the slip parameter allows for careless
mistakes. *(This is the exact example from the research paper, and the seeded parameters in
the database reproduce it precisely.)*

### `bkt_parameters`

The four parameters, stored as data rather than buried in code.

| Column | Type | What it's for |
| :--- | :--- | :--- |
| `key` | TEXT (PK) | e.g. `p_l0`, `g_tf`. |
| `value` | NUMERIC | The number, 0 to 1. |
| `description` | TEXT | What it means. |

Eleven rows: `p_l0`, `p_t`, `p_s`, plus eight `P(G)` values. Keeping them here means the
research paper's parameter table and the running system can be compared side by side.

### `bkt_mastery`

The current mastery estimate — **one row per student per concept.**

| Column | Type | What it's for |
| :--- | :--- | :--- |
| `id` | UUID (PK) | Row ID. |
| `student_id` | UUID | Which student. |
| `concept_id` | UUID | Which concept. |
| `latent_mastery` | NUMERIC | Current probability, 0 to 1. Starts at **0.10**. |
| `opportunity_count` | INTEGER | How many times they've practised it. |
| `last_updated` | TIMESTAMPTZ | When it last changed. |

`UNIQUE (student_id, concept_id)` guarantees a single score per student per concept —
impossible to end up with two conflicting values.

### `bkt_update_logs`

An **append-only** record of every single mastery change. Nothing is ever edited or deleted.

| Column | Type | What it's for |
| :--- | :--- | :--- |
| `id` | UUID (PK) | Row ID. |
| `student_id`, `concept_id` | UUID | Who and what. |
| `source` | bkt_source | `flashcard` or `adaptive_test`. |
| `observation` | SMALLINT | 1 = correct, 0 = incorrect. |
| `p_l_prior` | NUMERIC | Mastery *before* this answer. |
| `p_guess`, `p_slip`, `p_transit` | NUMERIC | The exact parameters applied. |
| `p_l_evidence` | NUMERIC | Result of step 1. |
| `p_l_posterior` | NUMERIC | Result of step 2 — the new mastery. |
| `flashcard_id`, `practice_test_id` | UUID | Which activity caused it. |
| `question_type`, `rating` | — | Extra context. |
| `created_at` | TIMESTAMPTZ | When. |

**Why this table earns its keep.** The research requires proving the BKT code computes
correctly, measured as an *Implementation Correctness Rate*: work the maths out by hand,
compare against the system, and pass if the difference is within ±0.01. Because every row
stores the starting point, the exact parameters, and both steps, that comparison is one SQL
query rather than a debugging session. It also gives every mastery score a full paper
trail.

---

## Part 13 — Activity, streaks, and games

### `activity_logs`

Every study action of any kind, in one place.

| Column | Type | What it's for |
| :--- | :--- | :--- |
| `id` | UUID (PK) | Row ID. |
| `student_id` | UUID | Who. |
| `activity_type` | activity_type | Flashcards, recall, feynman, test, game, or chat. |
| `space_id`, `material_id` | UUID | Optional context. |
| `duration_ms` | INTEGER | How long it took. |
| `occurred_at` | TIMESTAMPTZ | When. |

Streaks and total study hours are both calculated from this one table, so *any* studying
counts — not just games.

**About the timezone.** Streak days are measured in **Asia/Manila**, the school's local
time. Using the server's default (UTC) would mean a student studying at 7 a.m. in Manila
gets credited to the *previous* day, quietly breaking their streak.

### `gamification_profiles`

One row per student holding their running totals.

| Column | Type | What it's for |
| :--- | :--- | :--- |
| `student_id` | UUID (PK) | Which student. |
| `day_streak` | INTEGER | Current run of consecutive days. |
| `longest_streak` | INTEGER | Personal best. |
| `total_study_hours` | NUMERIC | Lifetime study time. |
| `last_active_on` | DATE | Last day they studied (Manila time). |

**How the streak works.** When activity is logged, the database compares today against
`last_active_on`:

- **Same day already counted** → nothing changes. Studying five times today is still one day.
- **Exactly the next day** → streak + 1.
- **A gap of two or more days** → streak resets to 1.

The "same day" rule matters: an earlier version of this logic added +1 on every game
session, so five games in one afternoon produced a bogus five-day streak.

### `game_sessions`

A completed game.

| Column | Type | What it's for |
| :--- | :--- | :--- |
| `id` | UUID (PK) | Session ID. |
| `student_id` | UUID | Who played. |
| `space_id`, `material_id` | UUID | Where the content came from. |
| `game_type` | game_type | Crossword, term matcher, or timed trivia. |
| `accuracy` | NUMERIC | Score, 0 to 1. |
| `time_spent_ms` | INTEGER | Duration. |
| `mastery_snapshot` | NUMERIC | Mastery used to set the difficulty. |
| `detail` | JSONB | Per-question breakdown for review. |
| `completed_at` | TIMESTAMPTZ | When. |

### `game_content`

The AI-generated puzzle itself, saved so it can be replayed without regenerating.

| Column | Type | What it's for |
| :--- | :--- | :--- |
| `id` | UUID (PK) | Content ID. |
| `student_id`, `space_id` | UUID | Who it was made for. |
| `material_ids` | UUID[] | Source materials. |
| `game_type` | game_type | Which game. |
| `difficulty` | TEXT | Difficulty setting. |
| `mastery_snapshot` | NUMERIC | The mastery reading used. |
| `payload` | JSONB | The actual grid / pairs / questions. |
| `created_at` | TIMESTAMPTZ | When generated. |

**Games read mastery but never write it.** `mastery_snapshot` records what the game was
tuned to, so you can verify a struggling student got an easier crossword — but no game
result ever changes `bkt_mastery`.

### `user_badges`

| Column | Type | What it's for |
| :--- | :--- | :--- |
| `id` | UUID (PK) | Badge award ID. |
| `student_id` | UUID | Who earned it. |
| `badge_name` | TEXT | e.g. "Flashcard Streak". |
| `awarded_at` | TIMESTAMPTZ | When. |

`UNIQUE (student_id, badge_name)` means the same badge can't be awarded twice.

---

## Part 14 — Views (pre-built reports)

A view is a saved question. It stores nothing and is always up to date.

Both views are marked `security_invoker`, meaning **they run with the permissions of whoever
is asking**. Without that setting a view runs with its creator's permissions, which would
let anyone who can open it see *every* student's mastery.

### `v_student_material_mastery` — the student's progress bar

For each student and each material in their study spaces:

| Column | Meaning |
| :--- | :--- |
| `student_id`, `material_id` | Who and what. |
| `concept_count` | Total concepts in the material. |
| `assessed_concept_count` | How many they've actually practised. |
| `m_doc` | **Overall mastery for this document.** |
| `tier` | `foundational`, `intermediate`, or `advanced`. |
| `mastered_concept_count` | Concepts at 0.85 or above. |
| `last_updated` | Most recent change. |

`m_doc` is the average mastery across every concept in the material. Concepts never
practised count as the 0.10 starting value, so the bar reflects real progress through the
whole document rather than only the parts already attempted.

### `v_grade_level_mastery` — the educator's class dashboard

The same figures, arranged for teachers: every student in the grades they published to, against every
material they published, with grade and subject attached.

This view deliberately does **not** go through `v_student_material_mastery`. That view
joins the student's study-space tables, which educators cannot read — so building on it
returned an empty dashboard every time. It instead works straight from
materials → concepts → students, which normal permissions already scope correctly.

---

## Part 15 — Functions

### Public functions

#### `update_updated_at_column()`
Sets `updated_at` to the current time whenever a row is edited. Used by `profiles`,
`study_spaces`, and `materials` so nobody has to remember to do it manually.

#### `match_concepts(query_embedding, material_ids, match_count, match_threshold)`
Powers the chatbot's `rag` mode. Given the meaning fingerprint of a question, returns the
most similar concepts from the chosen materials, ranked best-first.

`match_threshold` is the interesting part: concepts scoring below it are dropped entirely,
so an off-topic question returns **nothing** rather than the least-bad match. That's how the
chatbot knows to say "that isn't covered in your materials." The chat route passes ~0.60.

#### `document_mastery(student_id, material_id)`
The overall mastery for one student on one document — the average across all its concepts,
counting unpractised ones as 0.10. This is equation 4 from the research paper.

#### `mastery_tier(mastery)`
Turns a number into a difficulty label, keeping the thresholds in exactly one place:

| Input | Output |
| :--- | :--- |
| Below 0.50 | `foundational` |
| 0.50 – 0.85 | `intermediate` |
| 0.85 and above | `advanced` |

#### `handle_new_user()`
Runs automatically when an admin creates a login. Copies the name, role, and grade level
into `profiles`, and creates a `gamification_profiles` row **for students only** (educators
and admins don't have streaks).

It fills in sensible defaults rather than failing, because an error here would abort account
creation and surface as a confusing Supabase Auth failure. The application validates the
details before creating the account.

#### `update_study_streak()`
Runs whenever activity is logged. Applies the streak rules described in
[Part 13](#part-13--activity-streaks-and-games) and adds to total study hours.

#### `enforce_profile_immutables()`
Stops students promoting themselves. Permissions control *which rows* you may edit, not
*which columns* — so a student allowed to update their own profile could otherwise set their
role to `admin`. This function blocks any change to `role`, `status`, or `grade_level`
unless the person making it is an admin (or the backend itself).

#### No publish-scope check
There is deliberately no trigger policing what an educator may upload. Any educator may file
a material under any subject in the catalogue and grant access to any JHS grades:

| Attempt | Result |
| :--- | :--- |
| Science → Grade 7 | ✅ allowed |
| Science → Grades 7, 8, 9 **and** 10 | ✅ allowed |
| Filipino → Grade 7 | ✅ allowed |
| Mathematics → Grade 7 | ✅ allowed |
| `BASKETWEAVING` → Grade 7 | ❌ rejected — not in the `subjects` catalogue |
| Science → Grade 11 | ❌ rejected — `materials_grade_levels_valid` |

The last two are the only limits, and both come from ordinary table rules rather than a
trigger.

### Private functions (the `private` schema)

These four answer "who is asking?" and are used inside the security rules.

| Function | Returns |
| :--- | :--- |
| `private.auth_role()` | The current user's role, or nothing if they're disabled or not logged in. |
| `private.auth_grade_level()` | The current student's grade level. |
| `private.auth_assigned_grades()` | The grades the current educator may monitor — **calculated from the `grade_levels` of the materials they published**, so it always matches what they actually shared. Nothing at all if they haven't published yet. |
| `private.owns_study_space(id)` | True if the current user owns that study space. |

**Why a separate `private` schema.** Supabase automatically publishes everything in the
normal `public` area as a web address. These helpers shouldn't be callable over the web, but
the security rules still need them. Putting them in `private` hides them from the web while
leaving them fully usable internally.

> The obvious alternative — leaving them in `public` and revoking permission — was tried and
> **broke every student's access**, because security rules are evaluated using the asking
> user's permissions. Separating by schema is the approach that works.

---

## Part 16 — Triggers (automatic reactions)

| Trigger | Fires when | What it does |
| :--- | :--- | :--- |
| `on_auth_user_created` | A new login is created | Builds the profile and gamification row. |
| `trg_profiles_updated_at` | A profile is edited | Stamps `updated_at`. |
| `trg_study_spaces_updated_at` | A study space is edited | Stamps `updated_at`. |
| `trg_materials_updated_at` | A material is edited | Stamps `updated_at`. |
| `trg_profiles_immutables` | Before a profile is edited | Blocks self-promotion. |
| `trigger_update_streak` | Activity is logged | Updates streaks and study hours. |

---

## Part 17 — Row-Level Security

### The idea

Normal permissions work per *table*: you can read `materials` or you can't. **Row-Level
Security (RLS)** works per *row*: you can read the materials for your grade, and the others
don't exist as far as you're concerned.

This isn't hiding things in the interface. A Grade 7 student asking for all materials
receives only Grade 7 materials — the rest are invisible at the database level.

Every table in this schema has RLS switched on and at least one rule. Two states are both
dangerous and neither occurs here:

- **RLS off** — everyone sees everything. (`game_content` was in this state and was fixed.)
- **RLS on with no rules** — nobody sees anything, which silently breaks features.

### What each role can reach

| Data | Student | Educator | Admin |
| :--- | :--- | :--- | :--- |
| Own profile | read + edit | read + edit | — |
| Other profiles | ❌ | students in grades they published to | full control |
| Subjects | read | read | full control |
| Materials | those for their grade | own only, full control | read |
| Concepts | via accessible materials | via own materials | ❌ |
| Study spaces, decks, flashcards | own only | ❌ | ❌ |
| Free Recall / Feynman writing | own only | ❌ | ❌ |
| Chatbot history | own only | ❌ | ❌ |
| Practice tests and answers | own only | ❌ | ❌ |
| Mastery scores | **read only** | students in grades they published to, read | ❌ |
| Mastery audit trail | **read only** | students in grades they published to, read | ❌ |
| Activity log | read + add | ❌ | ❌ |
| Streaks and badges | **read only** | ❌ | ❌ |
| Games | own only | ❌ | ❌ |
| BKT parameters | read | read | full control |

### Two deliberate design choices

**Students can read their mastery but never write it.** There is no rule allowing a student
to insert or update `bkt_mastery`, `bkt_update_logs`, `gamification_profiles`, or
`user_badges`. Even someone using the public API key directly cannot inflate their own
scores — only the backend can, after running the BKT maths.

**Educators cannot see students' private work.** They see mastery *numbers* for their
grades, but not study spaces, flashcards, Free Recall essays, Feynman explanations, or chat
history. Verified: an educator querying those tables gets zero rows.

### An important caveat

The Express backend connects with an administrative key that **bypasses RLS entirely**. So
these rules are:

1. a safety net protecting direct database access with the public key, and
2. the thing the documented security tests are run against.

**The application code must still check roles and ownership itself.** RLS is the second
lock, not the only one. This is exactly why the publishing rule is a trigger — triggers
apply to the backend too.

---

## Part 18 — File storage

Uploaded PDFs live in Supabase Storage, in a bucket called `materials`.

| Setting | Value | Why |
| :--- | :--- | :--- |
| Public? | **No** | A public bucket hands any PDF to anyone who knows the address, defeating grade-level access entirely. |
| Size limit | 20 MB | The documented limit. |
| Allowed types | PDF only | Nothing else can be uploaded. |

Four rules govern the files:

| Rule | Effect |
| :--- | :--- |
| Educators upload their own materials | Files must go in a folder named after the educator. |
| Educators read their own material files | They can open what they uploaded. |
| Educators manage their own material files | They can delete what they uploaded. |
| Students read materials for their grade | Only files whose material is published to their grade. |

Because the bucket is private, the backend hands out **short-lived signed links** (valid one
hour) rather than permanent addresses.

---

## Part 19 — Quick reference

### All 21 tables

| Table | Holds |
| :--- | :--- |
| `profiles` | Everyone: students, educators, admins |
| `subjects` | The official subject list |
| `study_spaces` | Students' private study folders |
| `study_space_materials` | Which materials each space uses |
| `materials` | Educator-uploaded PDFs |
| `concepts` | Key terms extracted by AI, with meaning fingerprints |
| `flashcard_decks` | Groups of flashcards |
| `flashcards` | Individual cards |
| `spaced_repetition_logs` | Every card rating |
| `cognitive_logs` | Free Recall and Feynman submissions |
| `chatbot_logs` | Chatbot conversations |
| `practice_tests` | Generated tests |
| `practice_telemetry` | Every question answered |
| `bkt_parameters` | The BKT settings |
| `bkt_mastery` | Current mastery per student per concept |
| `bkt_update_logs` | Full audit trail of mastery changes |
| `activity_logs` | Every study action |
| `gamification_profiles` | Streaks and study hours |
| `game_sessions` | Completed games |
| `game_content` | Generated puzzles |
| `user_badges` | Earned badges |

### Where each feature stores its data

| Feature | Tables used | Changes mastery? |
| :--- | :--- | :--- |
| Upload a PDF | `materials`, `concepts` | — |
| Build a study space | `study_spaces`, `study_space_materials` | — |
| Flashcards | `flashcard_decks`, `flashcards`, `spaced_repetition_logs` | ✅ **Yes** |
| Adaptive Test | `practice_tests`, `practice_telemetry` | ✅ **Yes** |
| Free Recall | `cognitive_logs` | ❌ No |
| Feynman Technique | `cognitive_logs` | ❌ No |
| AI Chatbot | `chatbot_logs` | ❌ No |
| Games | `game_content`, `game_sessions` | ❌ No |
| Streaks and badges | `activity_logs`, `gamification_profiles`, `user_badges` | ❌ No |
| Educator dashboard | `v_grade_level_mastery` | ❌ No |

### The numbers worth remembering

| Value | Meaning |
| :--- | :--- |
| **0.10** | Starting mastery, P(L₀) |
| **0.20** | Learning rate, P(T) |
| **0.15** | Slip probability, P(S) |
| **0.50 / 0.85** | Difficulty tier boundaries |
| **0.70** | Free Recall "covered" threshold |
| **0.60** | Chatbot relevance cut-off |
| **1 / 3 / 7** | Flashcard review intervals in days (Hard / Medium / Easy) |
| **7–10** | Valid grade levels |
| **20 MB / 20 pages** | Upload limits (normal PDF / scanned PDF) |
| **3072** | Numbers in a concept's meaning fingerprint |

---

*Companion documents in this folder: [`chatbotImplementation.md`](chatbotImplementation.md),
[`freeRecallImplementationPlan.md`](freeRecallImplementationPlan.md),
[`feynmanImplementationPlan.md`](feynmanImplementationPlan.md),
[`gamemodesAIgenerationImplementation.md`](gamemodesAIgenerationImplementation.md).*
