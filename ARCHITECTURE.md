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
AI Integration: Gemini API (text-embedding-004)

Upload Flow:
  1. Educator uploads a PDF learning resource through the Educator Portal and selects the grade level(s) that can access it.
  2. Backend inserts a record into materials with parsed_status = 'pending'.
  3. The platform accepts plain-text PDF learning modules with a maximum file size of 20 MB, and also supports image-based or scanned PDF documents with a maximum of 20 pages.

Processing Flow (Background Job):
  - A backend worker detects the pending material.
  - Extracts text from the document.
  - Uses Gemini/LLM to extract key terms and definitions.
  - Calls Gemini Embeddings API to convert definitions into vector(768).
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
  - Future adaptive features (test difficulty, game difficulty) consume this updated mastery value.

---

5. Free Recall

Core Tables: cognitive_logs, concepts

Logic Flow:
  - Student is prompted to type all the information they remember from their studied materials, without looking at any notes.
  - Student submits user_input (free-form text).
  - Scoring: Backend converts user_input to a vector via Gemini Embeddings API. It runs a pgvector cosine similarity query (<=>) comparing the student's vector against the reference concept vectors. The resulting cosine similarity score is stored as similarity_score.
  - AI Feedback: Backend sends the reference material context and the student's input to Gemini, prompting it to:
      * Identify which concepts the student missed entirely.
      * Flag areas where their understanding was incomplete or unclear.
      * Provide constructive, actionable feedback.
  - The ai_feedback text and similarity_score are stored in cognitive_logs and returned to the UI.
  - Free Recall provides personalized explanations and feedback but does not directly update BKT mastery estimates.

---

6. Feynman Technique

Core Tables: cognitive_logs

Logic Flow:
  - Student is prompted to explain a concept from the educator-uploaded materials in their own words, as if teaching a 10-year-old child.
  - Student submits their explanation text.
  - AI Evaluation Pipeline (Three-Step Process):
      1. Jargon Check: The AI scans the student's explanation and compares it against the main glossary list extracted during the document upload phase. If the student uses highly complex terms without breaking them down simply, the AI flags those words and tells the student to explain them in simpler terms.
      2. Analogy Verification: The AI checks if the student used a helpful comparison or everyday story (analogy) to make the idea clear and easier to grasp.
      3. Finding the Gaps: The AI compares the student's simple explanation against the concept's true definition stored in the system to check whether anything is factually wrong, missing, or incomplete. It produces an accuracy score from 0 to 100 and a matching verdict of Correct, Needs Improvement, or Incorrect.
  - The AI writes short, encouraging feedback that points out what the student got right, names any factual errors directly, and tells them specifically how to improve.
  - The ai_feedback is stored in cognitive_logs and surfaced to the student.
  - The Feynman Technique provides personalized feedback but does not directly update BKT mastery estimates.

---

7. Test Mode (Adaptive BKT Testing)

Core Tables: practice_tests, practice_telemetry, bkt_mastery
AI Integration: Gemini (Text Generation)

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
  Since LearnSync AI is a newly developed platform with no pre-existing historical student interaction data, the system cannot utilize data-driven parameter estimation methods such as Expectation Maximization (EM) fitting. Instead, BKT parameters are initialized using empirically grounded default values from established educational data mining research (Bulut et al., 2023):

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

Note: BKT is inherently self-correcting. Even if default parameters do not perfectly represent a given student's learning behavior, the Bayesian updating mechanism continuously refines mastery estimates as more interaction data accumulates. The system's accuracy improves organically as students complete more practice attempts.

Note: The system does NOT use pyBKT or any external BKT library. The four-parameter BKT update equations are implemented directly in the platform backend code. Data-driven parameter estimation methods such as Expectation Maximization (EM) are not used due to the lack of pre-existing historical student interaction data.

---

9. Gamification (PlayMe Module)

Core Tables: game_sessions, gamification_profiles, user_badges

Games Available:
  - Crossword: AI generates a crossword puzzle from vocabulary and key terms extracted from the educator-uploaded materials.
  - Term Matching: AI generates term-definition pairs for a card matching game based on study space content.
  - Timed Trivia: AI generates timed trivia questions drawn from the educator-uploaded learning resources.

BKT-Adaptive Difficulty (Gamification Calibration):
  - Game content difficulty is dynamically adjusted based on the student's BKT mastery score (M_doc).
  - When a game session is initialized, the system retrieves the current M_doc value and applies it as a baseline parameter to the generative AI prompt.
  - The game engine uses this value to adjust vocabulary complexity, clue difficulty, and trivia response timers to align with the student's knowledge threshold.
  - AI-generated educational games utilize existing mastery estimates only to personalize question selection, generated content, and difficulty level. Games do NOT modify the learner's BKT mastery state.

Session Logging:
  - When a game session concludes, the frontend posts final stats (game_type, accuracy, time_spent_ms) to game_sessions.

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

---

11. Free Recall Scoring — Coverage Ratio

The Free Recall evaluation pipeline works as follows:
  1. Extract: Gemini extracts discrete concepts the student discussed from their raw text.
  2. Embed: Each extracted concept is embedded individually (not the whole essay).
  3. Compare: Each reference concept from the DB is compared against all student concept vectors via cosine similarity. The highest score is taken as the best match.
  4. Grade: A reference concept is "Covered" if its best match score ≥ 0.70; otherwise "Missed".
  5. Score: similarity_score = coveredCount / totalConcepts (coverage ratio, NOT average of raw scores).