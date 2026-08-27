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

Study Space Architecture: Students create their own study spaces. A student chooses a SUBJECT, not an educator — the space is then filled automatically with every material published to that subject and the student's grade level, whoever uploaded it. (An earlier draft of this document said the student "selects which educator's materials they want to use"; that was never built and would contradict the grade-level access rule, which is keyed on subject and grade and never on a teacher.) Each study space serves as a self-contained learning environment and contains five functional tabs:

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
  - An identical resubmission cannot drift across a verdict band boundary — but temperature 0 is
    no longer what guarantees it. Gemini 3 dropped the sampling parameters entirely, so there is
    no model-side knob left; findMemoisedAttempt() answers a byte-identical resubmission from the
    row it produced last time. That is exact, costs no API call, and holds whichever model is
    configured.
  - The audience is fixed at a 10-year-old child. FEYNMAN_AUDIENCES is a single-value enum so adding an audience later is one rubric plus one entry, not a data migration.
  - The ai_feedback is stored in cognitive_logs as a JSON string and surfaced to the student.
  - The Feynman Technique provides personalized feedback but does not directly update BKT mastery estimates, and like Free Recall it does not read them either — its grading is against the stored concept definition and the audience rubric, neither of which depends on mastery.

---

7. Test Mode (Adaptive BKT Testing)

Core Tables: practice_tests, practice_telemetry, bkt_mastery
AI Integration: Gemini gemini-3.6-flash at ThinkingLevel.MINIMAL (question writing)
  - The paper (p. 81) specifies only "the large language model", so nothing in the write-up
    depends on which provider this is. That mattered: this call site has moved twice.
  - HISTORY. It ran on Gemini, moved to Groq llama-3.3-70b-versatile on 2026-08-06 to escape
    Gemini's per-model daily quota, and came back to Gemini on 2026-08-18. Groq had
    DECOMMISSIONED that model on 17 June 2026 — verified against our own key, "The model does
    not exist or you do not have access to it" — and closed its paid tier to new signups, so the
    escape route stopped existing and could never have scaled to the 50-student study anyway.
    Groq was removed from the project entirely on 2026-08-19.
  - The quota problem the Groq detour was fleeing is therefore still real, and is now a reason to
    buy the paid key rather than to switch provider. Gemini's free tier refuses on TWO windows,
    both per model: 5 requests per MINUTE and 20 per day. One test is five calls, so a single
    test consumes the whole per-minute allowance, and the daily bucket is shared with concept
    extraction, Feynman grading, flashcard fronts and all three games — roughly four tests a day.
  - MINIMAL thinking is not a tuning preference. Measured: gemini-3.6-flash runs ~2s at MINIMAL
    against 5-20s at LOW and 8s+ at MEDIUM, and thinking tokens bill at the OUTPUT rate. Nothing
    in generation reasons — the server owns the true/false verdict, the correct option's position
    and the matching blocks, and grading is deterministic in server/lib/testGrading.ts.
  - Generation is one call PER FORMAT, not one for the whole test. responseSchema now does pin
    the structure per call, which Groq's JSON mode never did — but a five-way union of question
    shapes in one response still has no safe recovery. Per format the shape is uniform and a
    malformed item falls back to a template.
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
  - Study streaks and earned badges ARE displayed, as of 2026-08-19, fed by the gamification block on GET /api/dashboard — two plain SELECTs, never the GET /api/gamification/profile route, which used to INSERT a row on a GET. They are fetched alongside identity and spaces rather than with the other history reads, so a student whose educator archived every material still sees the streak they earned instead of a zero.
  - TOTAL STUDY HOURS IS STILL NOT DISPLAYED, and stays that way until something measures it. Only games and adaptive tests carry a real duration; flashcards, both cognitive modes and chat measure nothing, so the stored figure is a partial sum that would read as a total.
  - There is still no weekly activity chart and no heatmap. Both became buildable when activity_logs gained a writer, and both stay rejected: over a two-week study with a handful of attempts, an honest heatmap renders as an accusation.
  - Identity comes from GET /api/auth/me via src/context/AuthContext.tsx.

Accounts and sign-in: [IMPLEMENTED]
  - THE LOGIN IDENTIFIER IS profiles.username, not auth.users.email. Migration 0021 separated them; before it, sign-in ran directly on auth.users.email, which held username-like strings ('student', 'educ1', 'admin'). Each account's existing login string was backfilled into username, so no credential changed. auth.users.email is now contact information the user owns and can change, and is never a credential.
  - POST /api/auth/login is the only unauthenticated write. It resolves username to email SERVER-SIDE, then signs in and returns the session plus the caller's role for portal routing. The resolution is deliberately not exposed to the browser: a public username-to-email lookup requires no password, so it would let anyone harvest the real email addresses of Junior High students by guessing usernames. Every failure — unknown username, wrong password, absent username, disabled account — returns one identical message with no data, so the endpoint cannot be used to test which usernames exist.
  - It is also where a disabled account is stopped. The authenticate middleware deliberately does not check profiles.status (only requireRole does), so before this route a disabled account could still obtain a valid session.
  - PATCH /api/auth/me is the only writer for a user's own profile and accepts exactly first_name, last_name and username. role, status and grade_level are omitted from UpdateProfileSchema and the schema is strict, so sending one is a 400. This is the sole enforcement: enforce_profile_immutables() returns early when auth.uid() is NULL, which is the case for the service role the API holds, so the database trigger protects only direct anon-key access. grade_level is the critical field, since materialAccess.ts gates every student read on it.
  - POST /api/auth/change-password and POST /api/auth/change-email both re-verify the current password first, because Supabase's updateUser does not. A password change also revokes the user's other sessions, keeping their own.
  - Changing the email is a two-step flow: `POST /auth/change-email` verifies the current password and mails a 6-digit code to the **new** address, and `POST /auth/change-email/confirm` redeems it. Nothing is applied until the code comes back, so an address only lands on an account once someone has read mail sent to it. The two proofs answer different questions — the password proves the caller owns the account, the code proves they own the destination — and neither substitutes for the other. It used to apply immediately, which was tolerable only while nothing was ever mailed to the address; once a reset code can be, an unproven address is an account-takeover route. Requires **"Secure email change" to be OFF** in the Supabase dashboard, otherwise Supabase also demands confirmation from the old address — which is a placeholder or a bare word for exactly the accounts that need this most.
  - Usernames are unique case-insensitively via a functional index on lower(username), so 'Juan' and 'juan' cannot be two accounts — an impersonation vector where the username is the credential.
  - Profile photos are not implemented. profiles has no avatar column and there is no Storage bucket for them; both portals render an initials monogram.

First-login activation: [IMPLEMENTED]
  - An account created by an administrator is marked "Not activated" and cannot use the platform until its holder replaces the password. The reason is that the administrator chose or read that password, and a bulk import produces a table of fifty of them that is copied and printed — so until the student re-keys it, their teacher can sign in as them.
  - The state is stored as profiles.must_change_password, a column separate from status. account_status remains a two-value enum: the two are independent facts (an account can be disabled AND never activated), and status is the access gate read in roughly nineteen places including every RLS helper, so a third value would mean re-auditing all of them. The admin portal derives the single word it displays from both columns, with Disabled taking precedence.
  - The gate lives in requireRole, the only middleware that reads profiles. Four routes that mounted authenticate alone were therefore holes and were closed in the same change: both chat routes, GET /api/spaces/:id, POST /api/materials/concepts/batch (given requireRole('student')), and PATCH /api/auth/me plus POST /api/auth/change-email (gated for all roles). Both chat routes previously had no role check at all.
  - GET /api/auth/me and POST /api/auth/change-password stay deliberately ungated: they are the route to activation, and gating either would make a new account permanently unusable.
  - POST /api/auth/change-password is the only place an account becomes activated, clearing the flag after the password change succeeds. POST /api/admin/accounts/:userId/password re-arms it, because an administrator reset puts the account back into the same condition.
  - The client redirects to /set-password, which is mounted outside every layout — inside a guarded one the redirect would loop. RequireRole, previously used only by the admin portal, is now wired into all three layouts, since an un-activated account would otherwise render a full portal and fail every request without explanation.
  - Initial passwords are word-based (for example brave-otter-93) rather than random character strings, so they can be read aloud to a class. This is a deliberate reduction in strength — roughly 1.5 million combinations against 2.5 x 10^17 — and is acceptable only because the password is single-use under this gate and Supabase rate-limits sign-in attempts by source IP.

Username generation: [IMPLEMENTED]
  - POST /api/admin/username-suggestion derives a free username from a person's name in the first.last style, checked against the database for uniqueness and suffixed with a number when taken. It backs a Generate button beside the username field and fills blank username columns during bulk import.
  - It is admin-only, and that restriction is the reason it may exist. A username-availability check reachable without authentication is an enumeration oracle: it would let a stranger work through plausible names and learn which children attend the school. That is the same reasoning behind the single generic failure message on POST /api/auth/login.
  - Normalisation folds accented characters (Filipino names carry ñ routinely) and removes hyphens and apostrophes. A name with no usable letters returns an error rather than a fabricated fallback, because a username carrying no trace of the person cannot be matched to a class list.

Admin Portal (account management): [IMPLEMENTED]
  - Scope is create, edit and disable accounts for educators and students, and nothing else. Nothing under /api/admin reads materials, concepts, bkt_mastery or any other learning table; it touches only profiles and, through the Supabase admin API, auth.users. The admin role does not interact with learning content, study activities or analytics.
  - Before this, an admin could not use the platform at all: Login.tsx routed role === 'admin' to /educator/dashboard, where requireRole('educator') refuses every data call. It now routes to /admin/dashboard.
  - Seven routes, all behind authenticate + requireRole('admin'): GET /overview, GET /accounts, GET /accounts/:userId, POST /accounts, PATCH /accounts/:userId, POST /accounts/:userId/status, POST /accounts/:userId/password, and POST /accounts/import. GET /overview accepts nothing at all — no body, query or path parameter — so it has zero IDOR surface, the same bar as GET /api/dashboard and GET /api/educator/overview.
  - ACCOUNTS ARE DISABLED, NEVER DELETED. There is no delete route and no delete control. Thirteen tables cascade from profiles, so deleting one student would destroy every study space, all BKT mastery, all telemetry and every log irrecoverably — the study's own data. status = 'disabled' revokes access immediately (requireRole re-reads status on every request, so a live JWT stops working at once) and is fully reversible. Deletion is also the one operation the schema resists: materials.educator_id is ON DELETE RESTRICT, the only non-CASCADE foreign key.
  - Account creation is a single auth.admin.createUser call carrying user_metadata; the handle_new_user() trigger mirrors it into profiles and, for students, gamification_profiles. The route then RE-READS the profile to confirm the username survived, because that trigger degrades a malformed or already-taken username to NULL rather than raising — so a naive implementation reports success for an account nobody can sign in to. A collision deletes the auth user and answers 409 rather than leaving one behind.
  - A student's grade level is required at creation and is never defaulted. handle_new_user() would silently assign Grade 7, and that value decides which year's materials the account can open for its lifetime.
  - Assignable roles are student and educator only. Promoting to admin is refused, as is changing one's own role or one's own account status — there is a single admin account, and either would lock every administrator out permanently. UpdateAccountSchema is the sole enforcement, since enforce_profile_immutables() returns early for the service role.
  - Password recovery has **two tiers, and the floor never moves**. Tier 1 is self-service: `POST /auth/forgot-password` takes a username, resolves it to an address server-side, and mails a 6-digit code that `POST /auth/reset-password` redeems. Tier 2 is the admin reset below, which covers every account Tier 1 cannot — no address, a `@pca.invalid` placeholder from CSV import, or one of the bare words migration 0021 left behind. `EmailRecoveryBanner` is the only thing that moves an account from Tier 2 to Tier 1, since nothing else in the product ever asks for an address.
  - `POST /auth/forgot-password` **always answers 200**, identically for an unknown username, a disabled account, an undeliverable address, a throttled caller and a real send — the same doctrine as `LOGIN_FAILED`, and for a sharper reason: these usernames belong to identifiable minors at one named school. The address is never echoed back, **not even masked** — a domain plus a first letter is still a partial disclosure. The "nothing arriving? ask your teacher" copy on the page is what stops that uniformity from stranding anyone. `server/lib/otpThrottle.ts` limits sends and verify attempts **per username, not per IP**, because every request shares the server's address.
  - A self-service reset **clears** `must_change_password`; an admin reset **re-arms** it. The rule is who has seen the password. Both revoke sessions, and both revoke *before* changing the password — changing it first can invalidate the token the revocation needs.
  - The admin password reset also revokes the target's existing sessions — verified: both the access token and its refresh token are rejected afterwards. That holds because authenticate validates each request against the auth server rather than checking the JWT signature locally.
  - Bulk CSV import creates many accounts at once for the 50-student study. The whole file is validated before anything is written, including within-file duplicate usernames; creation is sequential because Supabase rate-limits the auth admin API by source IP. Generated passwords are displayed once and are not retrievable afterwards, only resettable.
  - Import is a modal opened from the Accounts page, beside "New account" — not a separate destination. It was formerly its own page and sidebar item, justified on the grounds that a multi-step flow (paste, review every row, commit) needs a page to itself. Both halves of that argument had to be answered rather than abandoned. First, the shared Modal component sets no maximum height, so a fifty-row table would overflow the viewport in both directions with the commit button below the fold and unreachable; the import modal therefore caps and scrolls its own content, sized against the modal's fixed chrome rather than as a fraction of the viewport, with the action row kept outside the scrolling region. Second, a page cannot be dismissed by accident whereas a modal closes on Escape, on a backdrop click and on the close button — and the results screen is the only time the generated passwords exist in readable form. Closing is therefore refused outright while the import is running, and requires confirmation afterwards until the credentials have been copied or saved to a file; "Import more" is guarded identically, since it discards the same data. A "Save as file" button writes the credentials as a CSV so an accidental dismissal is recoverable.
  - The import template contains only role, first name, last name, grade level and email — there is no username or password column. Both credentials are generated by the server and returned in the download at the end, so requiring the administrator to supply them would be work whose output is discarded, and hand-writing fifty usernames is precisely the chore the username generator exists to remove. Only role and the two name columns are mandatory in the header; a file of educators legitimately carries no grade level column. The parser still accepts a username or password column when one is present, so files built from the earlier template continue to work and an educator can still be given a chosen username — every rule that guarded a supplied value continues to apply.
  - The credentials file carries the account holder's name alongside the username and password, because it is distributed to the students themselves and a list of usernames and passwords alone cannot be handed out — nothing on it indicates whose line is whose, and generated usernames only appear self-explanatory until two students share a name. The names are returned by the import route rather than matched back by position, since a row can drop out of the results and shift every subsequent name by one. Cell values are quoted where required: a surname containing a comma would otherwise split across two columns and displace the password, giving a student someone else's credentials.
  - Usernames and email addresses typed into the file are checked against existing accounts on the review screen, via POST /api/admin/import/precheck, so a collision is reported as a row problem before anything is written. Duplicates within the same file are caught too, on both the client and the server. Previously only within-file username duplicates were detected, which meant a review screen could report fifty rows ready and then fail partway through — leaving a class half imported. The likeliest routes to that are re-uploading a corrected full file after a partial import, and siblings sharing a parent's address, which the unique index on auth.users.email refuses. Both fields are checked in a single call because they are needed at the same moment for the same decision. The check is a courtesy rather than a guarantee: the per-row checks during creation and both unique indexes remain the arbiters, and a failure of the check is deliberately non-fatal, since it costs only the early warning. Like the username-suggestion endpoint it is an enumeration oracle and is acceptable solely because it sits behind the admin role.
  - The email half of that check is the only remaining code that pages auth.users. Addresses are not stored on profiles, the auth schema is not exposed through the REST API, and the admin SDK offers no lookup by address, so paging the user list and comparing in memory is the only way to obtain the fact. This does not conflict with the admin overview dropping its own sweep: that ran on every dashboard load to answer a question a single column read answered better, whereas this runs once per file upload to obtain something otherwise unavailable.
  - Uploading a file is the only way to supply rows. A paste box existed alongside it and was removed: copying cells out of a spreadsheet places them on the clipboard separated by tabs, whereas the parser splits on commas, so the obvious way to use the box failed with a message about a missing header row — apparently a fault in the administrator's data rather than in the input method. The only clipboard content it accepted was raw CSV text copied out of a text editor, which is a more roundabout route than uploading the file itself. A drag-and-drop area replaced it, and a dropped file is parsed on arrival and advances straight to the review step. Files whose name does not end in .csv or .txt are rejected by name before parsing, because Excel saves .xlsx by default and a binary file would otherwise be reported as a malformed header row.
  - profiles has no email column, so the account list fetches no addresses; only the detail view resolves one.
  - An email address is REQUIRED when creating a single account and OPTIONAL for a bulk-import row. The asymmetry is deliberate: an administrator entering one account has the address to hand, whereas a class of fifty may be imported before fifty addresses have been collected. Only the import path can therefore produce a <username>@pca.invalid placeholder (RFC 2606 reserved TLD), and every screen that prints an email checks for one and renders "None set" instead — including the user's own profile page, which initially did not and showed students a fabricated address as their own.
  - Supabase enforces a unique index on auth.users.email, so no two accounts can share an address. That is why requiring a real email on every path was not viable: siblings sharing a parent's address could not both be created.
  - Passwords must be at least 8 characters and contain at least one non-alphanumeric character. One schema on the server governs every path that sets a password, with a single client-side mirror so the three forms cannot disagree. The rule applies to passwords being set, never to stored ones. Note that NIST SP 800-63B advises against composition rules of this kind, on the grounds that they produce predictable results; the requirement here is a deliberate project choice rather than a security recommendation.
  - src/components/common/RequireRole.tsx is the platform's first route guard and currently protects only the admin portal, so its shell never renders for a non-admin. The student and educator layouts remain unguarded; their API calls already refuse unauthorised callers.
  - Not implemented, deliberately: an admin action/audit log, and any UI for the subjects or bkt_parameters tables. RLS grants the admin both, but no specification assigns them to the role, and bkt_parameters is cached for the process lifetime — editing it mid-session would desync a student's audit trail from the ICR evidence.

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

Database Autopilot (Triggers): [IMPLEMENTED]
  - trigger_update_streak is an AFTER INSERT trigger on activity_logs — NOT on game_sessions. It moved there in migration 0005, because the earlier version incremented day_streak on every game insert, so five games in one afternoon produced a five-day streak.
  - It maintains day_streak, longest_streak, last_active_on and total_study_hours on gamification_profiles, and needs no help from application code: one insert into activity_logs is the whole streak mechanism.
  - STREAK LOGIC IS CALENDAR-DAY SUCCESSION IN ASIA/MANILA, NOT A 48-HOUR CLOCK. This document claimed the 48-hour rule until 2026-08-19 and was wrong; schema.sql has said so on the column comment since 0005. A new day extends the run only when it is exactly last_active_on + 1, and otherwise restarts at 1; repeat activity on a day already counted changes nothing. Manila rather than UTC because an early-morning session in the Philippines would otherwise be attributed to the previous day, and a bare occurred_at::date depends on the session TimeZone and cannot be indexed.

Activity writer: [IMPLEMENTED 2026-08-19]
  - Until this date NOTHING inserted into activity_logs, so the trigger had never once fired and day_streak was 0 for every student. Every gamification table had existed since migration 0005; the missing piece was a writer, not a schema.
  - server/lib/activity.ts is the single writer. logActivity() NEVER THROWS — it has nine call sites and no consumer that can act on a failure, so it logs to console.error and returns [] rather than making each caller remember a try/catch. A missing streak day must never cost a student their score.
  - Nine call sites: both flashcard branches (counted AND not-due practice), adaptive test completion, both Free Recall paths (fresh AND memo-hit), both Feynman paths, the game session insert, and the normal chat turn.
  - Three deliberate exclusions: the flashcard compare-and-swap loser (a duplicate request, not a second study event), the off-topic chat refusal (nothing was studied), and any PUT /complete that does not flip the status.
  - duration_ms is 0 wherever time is not measured. Only a game reports a real one (time_spent_ms) and only a test derives one — from the summed per-question latencies, not completed_at minus created_at, which would bill a test left open over dinner as three hours of study.

Streaks: [IMPLEMENTED]
  - Day Streaks: consecutive Asia/Manila calendar days on which the student engaged with any study activity — flashcards, adaptive tests, Free Recall, Feynman, games or the chatbot.
  - TOTAL HOURS IS WRITTEN BUT DELIBERATELY NOT DISPLAYED ANYWHERE. Only games and adaptive tests contribute a real duration, so the figure is a partial sum that would read as a total — the same failure as the frozen day_streak that kept streaks off the dashboard for months. GET /api/dashboard does not serialise it. The missing piece is real timing, not a widget.

Badges: [IMPLEMENTED]
  - Evaluated synchronously by server/lib/badges.ts immediately after each activity is logged, not by a cron job. The student sees a badge the moment they earn it, and UNIQUE (student_id, badge_name) makes the award idempotent, so an INSERT ... ON CONFLICT DO NOTHING needs no read-then-write lock.
  - Fourteen badges in four families: streaks (3 / 5 / 7 consecutive days), first-time activities (first flashcard, test, recall, explanation, game), mastery milestones (1 / 10 / 25 concepts at or above 0.85), and performance (a 100% test, a flawless game, 100 cards reviewed).
  - Streak badges are awarded off longest_streak, so they stack and are permanent: reaching 7 days leaves all three held, and breaking a streak never removes one.
  - Streak thresholds are sized to the roughly 2-week study. A 14-day badge was considered and dropped: an unreachable badge renders as a permanently grey tile that reads as a broken feature.
  - The catalogue lives in code, not in a badges table. badge_name is bare TEXT and the string IS the identity, so a badge is never renamed once live. A table nobody can edit would be a constant with extra steps, and building an editor for it would repeat the educator_assignments mistake.
  - Evaluation cost is bounded by ordering: one indexed read of the badges already held, then the catalogue is narrowed to (not held) AND (triggered by this activity type), and if nothing survives it returns without another query. That is the steady state, so an established student pays one lookup per activity — which matters because this runs after every individual flashcard rating.
  — Earning a badge opens a celebration modal, added 2026-08-20. Before it, a badge was awarded silently and the student only found out on their next dashboard visit.
  — The client is not TOLD about the award; it DIFFS. A provider mounted on the student layout re-reads GET /api/gamification/badges at six "you just finished something" moments and compares against what the session has already seen. Threading the award onto each write response was rejected for two concrete reasons: the flashcard rating POST is deliberately not awaited, so a badge on that response would open a modal over a card the student had already moved past; and the chat route logs its activity after res.end(), so its stream cannot carry one.
  — The baseline is seeded on mount and celebrates nothing, so a student who already holds badges is not ambushed on their next login. It is in-memory, so a reload re-seeds and nothing is celebrated twice.
  — One modal lists every badge that action earned, rather than a queue of dialogs. It is silent by choice — the modal can appear anywhere in the portal, unlike the games, which are opt-in and may have sound. Dismissal is manual, via button, Escape or the backdrop.
  — The confetti and the badge animations are all CSS keyframes in index.css and are all disabled under prefers-reduced-motion; the modal still opens and still names the badge.
  — Migration 0023 dropped the student INSERT policy on activity_logs. update_study_streak() is SECURITY DEFINER, so an anon-key insert moved day_streak, longest_streak and total_study_hours directly — harmless while nothing read them, a live fabrication route the moment a dashboard printed them. Express writes with the service role, which bypasses RLS, so nothing legitimate depended on it.

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

Verdict bands: overall_verdict is still computed and stored, and is deliberately NOT DISPLAYED. The old absolute bands (Strong >= 0.30, Partial >= 0.15) were tuned against a 78-concept lesson; applied to a 29-concept one they put an 86% answer and a 36% answer containing two factual errors in the same "Strong" band. Do not reintroduce a fixed threshold on this ratio — any constant is wrong for the next material uploaded. What the student sees instead is progressLine(), which compares covered_count against their own earlier attempt on the SAME material, past a noise floor of max(2, ceil(total * 0.1)).
The denominator is every concept extracted from the selected materials, and extraction is granular — a single lesson produced 78 concepts, including supporting details ("radio waves", "light pulses") no student writes out from memory. Recalling a document well therefore lands near 20–30%, not 75%. The ratio is left honest and the bands are calibrated to it, rather than rescaling the score itself.

Reproducibility: concept extraction is the only sampling step in the scoring pipeline, so an identical resubmission would otherwise extract a different concept list and score differently — measured, 14 / 16 / 17 covered across three runs of one submission. Temperature 0 used to pin it; Gemini 3 dropped the sampling parameters, so findMemoisedAttempt() now answers a byte-identical resubmission from the row it produced last time instead. It is keyed on a content fingerprint of the concept set (concepts has no updated_at column), so an educator editing a definition correctly forces a fresh evaluation.

Written Feedback:
  - After scoring, a second Gemini call writes ONE short prose passage plus corrections, stored as written_feedback inside the ai_feedback JSON. No separate column. It was three fields — strengths, gaps, next_steps — and the split was measured and removed: across every logged attempt next_steps was a paraphrase of gaps ("you left out injection" -> "review injection"), which is what forced structure does when the model must fill a slot and has nothing new to put in it. Rows written before the merge are not migrated, so treat every key inside ai_feedback as optional.
  - The prompt receives the student's raw text, the points extracted from it, the reference concepts they covered, and the ones they missed. Two students who score the same but wrote different things therefore receive different feedback.
  - It is told NOT to recite the missed list. That list is generated against the whole document and is full of supporting detail nobody recalls from memory; the model picks the 2-3 ideas that actually matter and names those in plain language.
  - Reproducibility is guaranteed by REUSE, not by temperature — and since Gemini 3 dropped the sampling parameters, reuse is the only mechanism left. findMemoisedAttempt() looks for an earlier attempt by the same student with the same text, the same materials AND the same concepts_fingerprint, and answers from it. Matching the fingerprint rather than the score means feedback is never reused after an educator changes the material underneath it, and it also means a resubmission costs zero API calls.
  - Failure is isolated. generateRecallFeedback() catches its own errors and returns null; the call sits outside the scoring try block and before the insert, so the row is still written with its score, verdict and missed list. The response carries feedback_unavailable: true and the tab shows a note instead of an error. Losing the feedback cannot cost the score.
  - When extraction finds nothing recognisable in the submission, a fixed in-code message is used rather than an AI call — there is nothing personal to say, and a canned message cannot fail.
12. Pre-Test / Post-Test — TEMPORARY research instrument [IMPLEMENTED 2026-08-21]
  - REMOVED AFTER THE SCHOOL STUDY. Full reference and removal checklist:
    LearnSyncAI artifacts/PREPOST_TEST_IMPLEMENTATION.md. Migration 0024.
  - Serves paper RQ4 (p. 55) — the difference between a student's standard pre-test score
    and their post-test score — which p. 103 names the primary evaluation instrument.
  - ONE PARALLEL PAIR PER MATERIAL, generated on an educator's explicit click, never on
    upload. Up to 20 multiple-choice items, each holding BOTH wordings on one row: same
    concept, same answer, same four options, different sentence and different option order.
    Everyone sits the same paper, which is what makes the two scores comparable at all.
  - THE MODEL WRITES ONLY THE SENTENCES. Options are four educator-vetted concepts.term
    values chosen by the server from the answer's document neighbourhood, so there is no
    hallucination surface on the answer key. One Gemini call per material.
  - NO DIFFICULTY TIER. A "standard pre-test" must not adapt; nothing reads bkt_mastery.
  - THE LOCK: a material is locked for a student while its assessment's LATEST released
    phase has no completed attempt by them — no PDF, no chatbot, no flashcards, no games,
    no Free Recall, no Feynman, no adaptive test. A pre-test is a baseline, so a student who
    reads the lesson first has an inflated baseline and a shrunken measured gain. Enforced
    server-side at nine call sites, each one line below the existing access check.
  - IT WRITES NOTHING THAT FEEDS THE PLATFORM — no bkt_mastery, no bkt_update_logs, no
    practice_telemetry, no activity_logs. bkt_source stays a two-value enum and activity_type
    gains no value. Consequence, stated rather than hidden: a pre-test does not extend a
    study streak.
  - The educator downloads a CSV of pre score / post score / gain per student. That table is
    the only place the study's primary measurement lives — export it before the tables are
    dropped.
