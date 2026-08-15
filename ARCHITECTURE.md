LearnSync AI: Backend Architecture & Logic Guide

Target Audience: AI Developer Agents, Backend Engineers, Full-Stack Developers.
Purpose: To explain the logical data flow, AI integration points, and database interactions for every major feature in the LearnSync AI application based on the established schema.sql

---

1. User Management

Core Tables: profiles

Authentication & Profiles: Supabase Auth handles standard login/registration. A trigger or frontend API call mirrors the authenticated user into the profiles table. LearnSync AI operates under three user roles:

  - Admin: Manages user accounts (creating, editing, disabling accounts for educators and students). The admin role does not interact with learning content, study activities, or analytics.
  - Educator: Uploads and manages official learning materials (PDF documents), assigns grade-level access controls to determine which students can access specific materials, and monitors student learning progress through a class-level analytics dashboard displaying individual student mastery levels.
  - Student: Accesses educator-uploaded learning materials assigned to their grade level and engages with the platform's AI-assisted learning features, including Adaptive Flashcards, Adaptive Test Mode, Feynman Technique, Free Recall, AI-generated educational games, and personalized learning analytics.

---

2. Study Spaces

Core Tables: study_spaces, materials

Study Space Architecture: Students create their own study spaces. When setting up a study space, a student selects which educator's materials they want to use — effectively fetching and linking resources from a chosen teacher. Each study space serves as a self-contained learning environment and contains five functional tabs:

  - Flashcards
  - Free Recall
  - Feynman Technique
  - Test Mode
  - Course Resources

Material Access Control: Only authenticated educators can upload learning resources. Educators select the appropriate grade level(s) that may access each uploaded material. Students receive access to materials assigned to their grade level through Row-Level Security (RLS) policies. Students cannot upload instructional materials.

---

3. Document Parsing & Semantic Storage (Course Resources Tab)

Core Tables: materials, concepts
AI Integration: Gemini API (gemini-embedding-001)

Upload Flow:
  1. Educator uploads a PDF learning resource through the Educator Portal and selects the ONE grade level that can access it. A material serves exactly one grade; the rule is enforced by the materials_grade_levels_valid CHECK, by Zod, and by a single-select control.
  2. Backend inserts a record into materials with parsed_status = 'pending'.
  3. The platform accepts plain-text PDF learning modules with a maximum file size of 20 MB, and also supports image-based or scanned PDF documents with a maximum of 20 pages.

Post-Upload Changes (PATCH /api/materials/:id, educator, own material only):
  - Grade level and archive state are the only editable fields. Subject is fixed after upload because a study space is built from its subject plus the materials published to it; parse fields are owned by the ingest pipeline.
  - Archiving hides a material from every student's study space at their next read. It is NOT a delete: the concepts, the study_space_materials link rows and every student's BKT mastery survive, so restoring brings all of it back with no bookkeeping. Deleting a material is the destructive path -- it cascades to concepts and to mastery.
  - Changing the grade level works by the same mechanism. Students in the old grade stop seeing it, students in the new grade gain it, the educator's Class Performance roster follows, and nothing is destroyed -- setting the grade back restores the original figures exactly.

Processing Flow (Background Job):
  - A backend worker detects the pending material.
  - Extracts text from the document.
  - Uses Gemini/LLM to extract key terms and definitions.
  - Calls Gemini Embeddings API to convert definitions into vector(3072).
  - Inserts these into the concepts table.
  - Updates materials to completed.

AI Chatbot: The Course Resources tab also hosts an integrated AI chatbot. Students can submit natural language questions about the educator-uploaded materials assigned to their grade level. The backend performs semantic similarity search via pgvector against the stored concept embeddings, retrieves relevant context, and passes it to the LLM (Retrieval-Augmented Generation) to produce a grounded, context-aware answer. The chatbot generates responses exclusively from educator-uploaded learning resources and cannot generate information beyond the available materials.

---

4. Flashcards with Spaced Repetition & BKT

Core Tables: flashcard_decks, flashcards, bkt_mastery

Flashcard Flow:
  - Students create flashcard decks within their study space.
  - They can manually add cards or use the AI auto-generation feature, which uses the educator-uploaded materials in the Course Resources tab to automatically generate relevant flashcard content.

Spaced Repetition Logic (Student Rating):
  - When a student flips a card, they self-rate their recall difficulty:
      * Easy   → card is scheduled to reappear after 7 days (Leitner later review tier)
      * Medium → card is scheduled to reappear after 3 days (Leitner intermediate tier)
      * Hard   → card is scheduled to reappear after 1 day (Leitner first review tier)
  - The next_review_at timestamp on the flashcard record is updated accordingly.

BKT Integration (Flashcard Mode):
  - On each card rating event, a BKT recalculation is triggered for the corresponding concept using default parameters.
  - Each rating maps to a binary observation and a confidence-based guess probability:
      * Easy   → obs = 1 (correct), P(G_easy) = 0.05 (genuine knowledge, minimal guessing)
      * Medium → obs = 1 (correct), P(G_medium) = 0.25 (moderate possibility of partial guessing)
      * Hard   → obs = 0 (incorrect), P(G_hard) = 0.10 (vague partial recall allowance)
  - The two-phase BKT update (evidence update then transition update) produces the student's new mastery P(L_{t+1}).
  - The updated latent_mastery in bkt_mastery reflects the student's knowledge state.
  - Three read-only consumers use this value without writing it: Adaptive Test difficulty, game difficulty calibration, and the student Analytics tab.

---

5. Free Recall

Core Tables: cognitive_logs, concepts

Logic Flow:
  - Student is prompted to type all the information they remember from their studied materials, without looking at any notes.
  - Student submits user_input (free-form text).
  - Scoring: see Section 11 for the authoritative algorithm. In brief, the backend extracts the discrete concepts the student discussed, embeds each one separately, and scores coverage against the material's stored concepts. Cosine similarity is computed in the backend, NOT via a pgvector <=> query — an earlier design did the latter, and migration 0006 dropped the evaluate_recall() function that implemented it.
  - The missed_concepts list and overall_verdict are stored in cognitive_logs.ai_feedback as a JSON string, alongside similarity_score.
  - Free Recall provides personalized explanations and feedback but does not directly update BKT mastery estimates. As built it does not READ them either — server/routes/cognitive.routes.ts contains no reference to bkt_mastery. Its personalization comes from the material's concept set, not from the student's mastery of it. (Paper p. 58 groups it with the games as a mastery reader; only the games actually are one.)

---

6. Feynman Technique

Core Tables: cognitive_logs

Logic Flow:
  - Student is prompted to explain a concept from the educator-uploaded materials in their own words, as if teaching a 10-year-old child.
  - Student submits their explanation text.
  - AI Evaluation Pipeline (Three-Step Process):
      1. Jargon Check: The AI scans the student's explanation and compares it against the main glossary list extracted during the document upload phase — every concept term belonging to the selected materials is passed into the grading prompt as that glossary. Terms from it that the student used without unpacking in plain words are flagged first; other technical vocabulary is flagged too. The concept's own term is never flagged (the student was asked to explain it), enforced both in the prompt and by stripSelfReferentialJargon() afterwards.
      2. Analogy Verification: The AI checks whether the student used a helpful comparison or everyday story (analogy). It returns analogy_used, analogy_quote (the comparison in the student's own words), and analogy_idea — a verdict on their comparison, or one they could have used when there was none.
         A claimed analogy is rejected on two independent grounds, so a student is never told they did something they did not:
           (a) No quote. The model asserted one without producing the student's words, so there is nothing to show and nothing to trust.
           (b) The quote is built from the lesson's own vocabulary, which makes it an in-domain example rather than an everyday comparison. analogyUsesLessonVocabulary() matches the quote against the material's glossary terms; when it fires, analogy_idea is replaced with IN_DOMAIN_ANALOGY_NOTE, because the model wrote its suggestion believing the comparison counted and it would otherwise read as praise under a "no comparison" heading.
         Measured against the live model, the prompt alone did not hold: "it's like a backup server taking over automatically" was accepted as an everyday comparison for Resilience. Hence the code-level backstop, which holds regardless of which model grades.
         The backstop matches WHOLE glossary terms only (with singular/plural tolerance in both directions), never their individual words. Splitting was tried and rejected: this material's glossary yields head nouns like "pages" (Web pages), "traffic" (HTTP/HTTPS traffic), "control" (Broken Access Control) and "waves" (Radio waves), so word-level matching would reject "like pages in a book" and "like traffic on a road" — exactly the analogies the feature exists to reward. The consequence is that a comparison sharing only a head noun ("a backup server") is left to the prompt. A false rejection is the worse error, since the student is then told to do something they already did.
         The concept's own name is always excluded, so "Defense-in-depth is like a castle" stays valid even though Defense-in-depth is itself a glossary term.
      3. Finding the Gaps: The AI compares the student's simple explanation against the concept's true definition stored in the system to check whether anything is factually wrong, missing, or incomplete. It produces an accuracy score from 0 to 100 and a matching verdict of Correct, Needs Improvement, or Incorrect.
  - The AI writes short, encouraging feedback that points out what the student got right, names any factual errors directly, and tells them specifically how to improve.
  - Two independent axes are scored: accuracy_score (against the stored definition) and simplicity_score (against the audience rubric). A fluent but false explanation must not score well, and neither must a textbook-perfect one a child could not follow.
  - The verdict is derived in the backend from accuracy_score (≥80 Correct, ≥30 Needs Improvement, else Incorrect), never taken from the model — asked for it directly, the model leaks the simplicity axis into it.
  - Grading runs at temperature 0, so an identical resubmission cannot drift across a verdict band boundary.
  - The audience is fixed at a 10-year-old child. FEYNMAN_AUDIENCES is a single-value enum so adding an audience later is one rubric plus one entry, not a data migration.
  - The ai_feedback is stored in cognitive_logs as a JSON string and surfaced to the student.
  - The Feynman Technique provides personalized feedback but does not directly update BKT mastery estimates, and like Free Recall it does not read them either — its grading is against the stored concept definition and the audience rubric, neither of which depends on mastery.

---

7. Test Mode (Adaptive BKT Testing)

Core Tables: practice_tests, practice_telemetry, bkt_mastery
AI Integration: Groq llama-3.3-70b-versatile (question writing)
  - Chosen over Gemini for one reason that outweighs the rest: Gemini's free quota is 20 requests
    per day PER MODEL, and concept extraction, Free Recall and Feynman already spend it. Putting
    test generation on the same key would trade working features for a new one during the study.
    Groq carries a separate, far larger budget and already runs chat, flashcard question writing
    and all three games.
  - The paper (p. 81) specifies only "the large language model", so nothing in the write-up
    depends on which provider this is.
  - Generation is one call PER FORMAT, not one for the whole test: Groq's JSON mode gives no
    structural guarantee, and a five-way union of question shapes in one response has no safe
    recovery. Per format the shape is uniform and a malformed item falls back to a template.
  - Grading involves NO model call. Multiple choice, true/false and matching compare exactly;
    identification and fill-in-the-blank use a mechanical alias ladder (server/lib/testGrading.ts)
    so a score the student is shown is reproducible.

Test Type Selection:
  - Students can select one or more question types when generating a test:
      * Multiple Choice
      * Identification
      * Matching Type
      * Fill in the Blank
      * True or False

Pre-Test Generation:
  - Student requests a practice test for a specific study space or uploaded material.
  - Backend queries bkt_mastery for the student's current latent_mastery (0.0–1.0) for the relevant concept_ids.
  - The adaptive test generation engine uses mastery thresholds to adjust LLM generation prompts:
      * Mastery ≥ 0.85 → Advanced-tier questions (analytical scenarios, synthesis, edge cases)
      * Mastery 0.50–0.85 → Intermediate-tier questions (conceptual comparisons, multi-concept recall, practical applications)
      * Mastery < 0.50 → Foundational-tier questions (direct definitions, basic conceptual associations)
  - LLM generates questions matching the selected question types and the student's adaptive difficulty profile. Questions are saved to practice_tests.

Taking the Test & Telemetry:
  - As the student answers questions, the frontend records is_correct and latency_ms and sends them to practice_telemetry.

BKT Recalculation (Per-Question, Context-Sensitive P(G)):
  - After each answer, BKT is recalculated using question-type-specific guess probabilities:
      * Multiple Choice (4 options): P(G_mc) = 0.25 (1/4 chance)
      * True or False: P(G_tf) = 0.50 (1/2 chance, binary format)
      * Identification: P(G_id) = 0.05 (open-ended, near-zero guessing)
      * Fill in the Blank: P(G_fib) = 0.05 (free recall, no selectable options)
      * Matching Type (4 terms, 6 definitions): P(G_match) = 0.17 (1/6 ≈ 0.17)
  - The two-phase BKT update (evidence update then transition update) produces the updated mastery.
  - It updates bkt_mastery. All future practice tests will adapt to this new mastery level.

---

8. Bayesian Knowledge Tracing (BKT) — Algorithm Details

BKT is the classical four-parameter probabilistic learner model implemented directly in the platform backend. It operates as a dynamic hidden Markov model (HMM) with observable nodes, continuously analyzing a student's sequential interactions to trace their latent knowledge state for any given concept.

Default Parameter Initialization:
  Since LearnSync AI is a newly developed platform with no pre-existing historical student interaction data, the system cannot utilize data-driven parameter estimation methods such as Expectation Maximization (EM) fitting. It therefore uses fixed values.

  These are SELECTED CONFIGURATION VALUES OPERATING WITHIN PUBLISHED LIMITS, not values derived from research data — the distinction matters and an earlier version of this document got it wrong. Bulut et al. (2023) is the source of the four-parameter framework; the literature does not recommend specific numbers, because published values are computed from each study's own dataset. What it provides instead are acceptable ranges, collected in Šarić-Grgić et al. (2024): Corbett and Anderson's P(G) < 0.30 and P(S) < 0.10, Beck and Chang's P(G) + P(S) < 1, and Baker, Corbett and Aleven's P(G) < 0.50 and P(S) < 0.50. Every value below was chosen to fall inside those limits and is verified against Beck and Chang's rule at boot.

  - P(L₀) = 0.10 — Initial knowledge state. Conservative 10% prior probability of pre-existing mastery.
  - P(T) = 0.20 — Transition probability (learning rate). 20% probability of transitioning from unmastered to mastered after each learning opportunity. Moderately conservative for self-directed learning contexts.
  - P(S) = 0.15 — Slip probability. 15% likelihood that a student who has mastered a concept still answers incorrectly due to carelessness, misreading, or cognitive fatigue. Slightly relaxed from the classical P(S) ≤ 0.10 constraint to accommodate self-directed learning without instructor monitoring.
  - P(G) = Context-Sensitive (Dynamic) — Guess probability varies by assessment mode, question format, and student confidence level (see Sections 4 and 7 for specific values per mode).

BKT Mathematical Model (Two-Phase Update):

  Evidence Update Phase:
    When correct (obs_t = 1):
      P(L_t | obs_t=1) = [P(L_t)(1 - P(S))] / [P(L_t)(1 - P(S)) + (1 - P(L_t))P(G)]

    When incorrect (obs_t = 0):
      P(L_t | obs_t=0) = [P(L_t)P(S)] / [P(L_t)P(S) + (1 - P(L_t))(1 - P(G))]

  Transition Update Phase:
      P(L_{t+1}) = P(L_t | obs_t) + (1 - P(L_t | obs_t)) * P(T)

Document Mastery Aggregation:
  When an educator uploads a study document, the document ingestion engine parses and extracts N distinct concept nodes. The overall mastery rate M_doc for a document is calculated using the arithmetic mean of all per-concept BKT probabilities:

    M_doc = Σ P(L_current, i) / N

  This aggregated score is displayed as a progress bar on the student dashboard and is used by the gamification module to calibrate game difficulty.

Student Dashboard (learning analytics display): [IMPLEMENTED]
  - GET /api/dashboard is the only global (all-spaces) student endpoint. Everything else is scoped to one owned space; a dashboard is about all of them, so fanning out client-side would cost 1 + N requests.
  - It accepts no body, no query and no path parameter. Every set is derived from the caller's own id, so it cannot be pointed at another student's data. It is read-only.
  - It returns: M_doc across every concept in every space (the p. 81 progress bar) with a per-space breakdown; a mastery curve; the weakest assessed concepts across all spaces; the global flashcards-due count; any unfinished test; and a merged recent-activity feed.
  - The mastery curve is reconstructed BACKWARD from bkt_mastery using the p_l_prior column of bkt_update_logs, so its final point equals the displayed mastery number by construction. bkt_mastery remains authoritative for the current value; the audit log only draws the history, which is why a failed log write stays non-fatal.
  - The curve's x axis is the learning-opportunity index t, not wall-clock time: updates within a session share a timestamp, and BKT has no forgetting term, so a time axis would misrepresent both.
  - Study streaks, digital badges and total study hours are NOT displayed. Nothing writes activity_logs and nothing awards user_badges, so those figures have no source; they are omitted rather than shown as zeros or stale values.
  - Identity comes from GET /api/auth/me via src/context/AuthContext.tsx.

Accounts and sign-in: [IMPLEMENTED]
  - THE LOGIN IDENTIFIER IS profiles.username, not auth.users.email. Migration 0021 separated them; before it, sign-in ran directly on auth.users.email, which held username-like strings ('student', 'educ1', 'admin'). Each account's existing login string was backfilled into username, so no credential changed. auth.users.email is now contact information the user owns and can change, and is never a credential.
  - POST /api/auth/login is the only unauthenticated write. It resolves username to email SERVER-SIDE, then signs in and returns the session plus the caller's role for portal routing. The resolution is deliberately not exposed to the browser: a public username-to-email lookup requires no password, so it would let anyone harvest the real email addresses of Junior High students by guessing usernames. Every failure — unknown username, wrong password, absent username, disabled account — returns one identical message with no data, so the endpoint cannot be used to test which usernames exist.
  - It is also where a disabled account is stopped. The authenticate middleware deliberately does not check profiles.status (only requireRole does), so before this route a disabled account could still obtain a valid session.
  - PATCH /api/auth/me is the only writer for a user's own profile and accepts exactly first_name, last_name and username. role, status and grade_level are omitted from UpdateProfileSchema and the schema is strict, so sending one is a 400. This is the sole enforcement: enforce_profile_immutables() returns early when auth.uid() is NULL, which is the case for the service role the API holds, so the database trigger protects only direct anon-key access. grade_level is the critical field, since materialAccess.ts gates every student read on it.
  - POST /api/auth/change-password and POST /api/auth/change-email both re-verify the current password first, because Supabase's updateUser does not. A password change also revokes the user's other sessions, keeping their own.
  - Changing the email applies immediately rather than through a confirmation link, because the project has no working SMTP (register auto-confirms) and the existing addresses are undeliverable, so a confirmation mail would never arrive. The consequence is that the new address is not proven to belong to the user; password-reset-by-email must not be enabled without adding that proof.
  - Usernames are unique case-insensitively via a functional index on lower(username), so 'Juan' and 'juan' cannot be two accounts — an impersonation vector where the username is the credential.
  - Profile photos are not implemented. profiles has no avatar column and there is no Storage bucket for them; both portals render an initials monogram.

Note: BKT is inherently self-correcting. Even if default parameters do not perfectly represent a given student's learning behavior, the Bayesian updating mechanism continuously refines mastery estimates as more interaction data accumulates. The system's accuracy improves organically as students complete more practice attempts.

Note: The system does NOT use pyBKT or any external BKT library. The four-parameter BKT update equations are implemented directly in the platform backend code. Data-driven parameter estimation methods such as Expectation Maximization (EM) are not used due to the lack of pre-existing historical student interaction data.

Implementation status: BUILT AND VERIFIED. The engine is `server/lib/bkt.ts`. Parameters are read from the `bkt_parameters` table rather than hardcoded. There are exactly two writers — `PUT /api/practice/:id/complete` and the counted branch of `POST /api/flashcards/rate` — matching the `bkt_source` enum and the Scope statement above. Every update appends a row to `bkt_update_logs` carrying the prior, the three applied parameters and both update phases, which is what the Implementation Correctness Rate is measured from. Run `npm run bkt:verify` for that measurement; `-- --live --live-test` extends it through the real HTTP endpoints.

Two consequences of the equations worth stating, because both look like defects:

  1. A wholly incorrect run raises mastery slightly rather than lowering it. P(L_{t+1}) = e + (1 - e)P(T) is minimised at P(T) = 0.20, above the P(L₀) = 0.10 prior, so repeated wrong answers converge upward to a fixed point — 0.25 for multiple choice, 2/7 for true/false. Both sit below the 0.50 tier threshold, so failing cannot unlock a harder test.

  2. Mastery is held strictly below 1. At exactly 1.0 the incorrect-answer update returns P(S)/P(S) = 1, making the state absorbing: no evidence could ever lower it again. Continuous BKT approaches 1 without reaching it, so the engine clamps to 1 - 1e-9 and preserves that property.

---

9. Gamification (PlayMe Module)

Core Tables: game_sessions, gamification_profiles, user_badges

Games Available:
  - Crossword: AI generates a crossword puzzle from vocabulary and key terms extracted from the educator-uploaded materials.
  - Term Matching: AI generates term-definition pairs for a card matching game based on study space content.
  - Timed Trivia: AI generates timed trivia questions drawn from the educator-uploaded learning resources.

BKT-Adaptive Difficulty (Gamification Calibration): [IMPLEMENTED]
  - Game content difficulty is dynamically adjusted based on the student's BKT mastery score (M_doc).
  - When a game is generated, the system computes M_doc (EQ 4) over the selected materials' concepts and derives one tier from it: foundational (< 0.50), intermediate (0.50-0.85), advanced (>= 0.85). Both the tier and the snapshot are stored on game_content, so the Difficulty Alignment check can be run against them.
  - The tier adjusts vocabulary complexity (which answer word a crossword clue points at, which terms reach a matching board), clue difficulty (three per-game guidance tables in server/lib/gameDifficulty.ts), and trivia response timers (20s / 15s / 10s).
  - Question selection is mastery-weighted: each concept's chance of reaching the prompt rises as its mastery falls, with a concept that has never been assessed treated as neutral rather than as its P(L0) prior — so "known weak" outranks "unknown", which outranks "known strong".
  - Difficulty is never client-supplied. The request body carries no difficulty field.
  - AI-generated educational games utilize existing mastery estimates only to personalize question selection, generated content, and difficulty level. Games do NOT modify the learner's BKT mastery state — nothing under the games path imports the BKT engine.

Session Logging:
  - When a game session concludes, the frontend posts { content_id, accuracy, time_spent_ms, detail } to game_sessions. Everything identifying what was played — space_id, material_id, game_type and mastery_snapshot — is copied server-side from the owner-checked game_content row, so the recorded mastery snapshot is the one the prompt was actually built from.

Database Autopilot (Triggers):
  - An AFTER INSERT PostgreSQL trigger intercepts the new game session.
  - It updates gamification_profiles (day streak, total hours studied).
  - Streak Logic: If the student's last active timestamp was less than 48 hours ago, day_streak += 1 (day streak increments). If more than 48 hours have elapsed, day_streak resets to 1.
  - The trigger also accumulates total hours studied across all activity types (flashcards, games, recall sessions, etc.).

Streaks:
  - The application tracks two streak dimensions:
      * Day Streaks: Consecutive days a student has engaged with any study activity. Example: using flashcards or crossword games for 5 consecutive days results in a 5-day streak.
      * Total Hours: Cumulative time spent studying, tracked across all modules.

Badges:
  - Badges are awarded based on milestone achievements, evaluated by backend cron jobs or trigger-based endpoint checks.
  - Example: A student achieving a 5-day streak on flashcards earns a Flashcard Streak badge.
  - Badge records are inserted into user_badges upon milestone completion.

---

10. Educator Portal

Core Tables: profiles, materials, bkt_mastery

Educator Dashboard:
  - Educators upload PDF learning materials through the Educator Portal.
  - Educators select which Junior High School grade level(s) can access each uploaded material.
  - The educator analytics dashboard aggregates student mastery data at the concept and document level into a real-time grade-level monitoring interface.
  - Educators can view individual student mastery levels and learning progress for students within their assigned grade level.
  - Row-Level Security (RLS) restricts educators to viewing mastery data only for students within their selected grade level.

Implementation (as built):
  - The analytics have two scopes. GET /api/educator/overview is the portal's landing page, across every material the educator has published; the /api/educator/materials/:materialId/* routes are the per-material drill-down reached through Materials → a material → Class Performance. There is no separate students roster; the pages that were one were mock data end to end and were removed — a student ACROSS materials now lives on the dashboard instead.
  - GET /api/educator/overview accepts nothing at all: no body, no query, no path parameter. Every set is derived from the caller's own id, so it has no IDOR surface, the same guarantee GET /api/dashboard gives on the student side. It costs four database round trips regardless of how many materials, students or concepts the educator has.
  - The dashboard covers LIVE materials only; archived ones are excluded from every figure and reported as a count. bkt_mastery rows survive archiving and re-grading, so they are intersected against the live concept set rather than counted.
  - The dashboard's per-material average is the same expression, over the same population, as the Class Performance tab's class average. The two screens show one number rather than two computations that happen to agree.
  - Alongside the averages the dashboard reports operational problems each material can have — extraction failed, still processing, no concepts extracted, published to a grade with no active students, or reaching students but nobody has started. Each is a different problem with a different fix, so exactly one reason is reported per material and the section disappears when there is nothing to report.
  - There is deliberately no class mastery curve over time. A per-student curve can be anchored to the student's stored mastery; a class mean cannot, because its denominator changes as students start — either absent students enter at the P(L₀) prior (printing an assumption as a measurement) or the class average falls whenever a new student begins, which reads as the class getting worse because someone joined.
  - "The class" for a material is every ACTIVE student whose grade_level is in that material's grade_levels. An educator's assigned grades are therefore derived from what they have published, not stored — there is no educator-grade table.
  - RLS is the design intent but NOT the enforcement mechanism at runtime: Express holds the Supabase service role, which bypasses RLS by design, so every route enforces ownership itself through server/lib/educatorScope.ts. The same reason v_grade_level_mastery (security_invoker) is not queried from the server.
  - Read-only. Mastery still has exactly two writers, both on the student side (adaptive flashcards and Adaptive Test Mode), per the paper's Scope section.
  - A student with no bkt_mastery row is at P(L₀) = 0.10 by assumption, so every mastery figure is nullable and unassessed students and concepts are shown as "not started" rather than as a percentage.
  - The educator's own name comes from their profile, like the student portal's. profiles carries no email column, so no email is displayed anywhere in the educator portal.

---

11. Free Recall Scoring — Coverage Ratio

The Free Recall evaluation pipeline works as follows:
  1. Extract: Gemini extracts discrete concepts the student discussed from their raw text.
  2. Embed: Each extracted concept is embedded individually (not the whole essay).
  3. Compare: Each reference concept from the DB is compared against all student concept vectors via cosine similarity. The highest score is taken as the best match.
  4. Grade: A reference concept is "Covered" if its best match score ≥ 0.70; otherwise "Missed".
  5. Score: similarity_score = coveredCount / totalConcepts (coverage ratio, NOT average of raw scores).

Verdict bands: Strong ≥ 0.30, Partial ≥ 0.15, otherwise Needs Review.
The denominator is every concept extracted from the selected materials, and extraction is granular — a single lesson produced 78 concepts, including supporting details ("radio waves", "light pulses") no student writes out from memory. Recalling a document well therefore lands near 20–30%, not 75%. The ratio is left honest and the bands are calibrated to it, rather than rescaling the score itself.

Reproducibility: the concept-extraction call runs at temperature 0. It is the only sampling step in the scoring pipeline, so without it an identical resubmission would extract a different concept list and score differently.

Written Feedback:
  - After scoring, a second Gemini call writes three short pieces of coaching — strengths, gaps, next_steps — stored as written_feedback inside the ai_feedback JSON. No separate column.
  - The prompt receives the student's raw text, the points extracted from it, the reference concepts they covered, and the ones they missed. Two students who score the same but wrote different things therefore receive different feedback.
  - It is told NOT to recite the missed list. That list is generated against the whole document and is full of supporting detail nobody recalls from memory; the model picks the 2-3 ideas that actually matter and names those in plain language.
  - Reproducibility is guaranteed by REUSE, not by temperature. Temperature 0 pins the score because extraction returns a structured list and the 0.70 threshold quantises the remainder — but free prose has no such quantisation, and in testing the same input reliably scored the same while producing reworded paragraphs. So before generating, findPreviousFeedback() looks for an earlier attempt by the same student with the same text, the same materials AND the same resulting score, and reuses its prose. Requiring the score to match means feedback is never reused after an educator changes the material underneath it.
  - Failure is isolated. generateRecallFeedback() catches its own errors and returns null; the call sits outside the scoring try block and before the insert, so the row is still written with its score, verdict and missed list. The response carries feedback_unavailable: true and the tab shows a note instead of an error. Losing the feedback cannot cost the score.
  - When extraction finds nothing recognisable in the submission, a fixed in-code message is used rather than an AI call — there is nothing personal to say, and a canned message cannot fail.