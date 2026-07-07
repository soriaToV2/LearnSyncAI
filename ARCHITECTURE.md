LearnSync AI: Backend Architecture & Logic Guide

Target Audience: AI Developer Agents, Backend Engineers, Full-Stack Developers.
Purpose: To explain the logical data flow, AI integration points, and database interactions for every major feature in the LearnSync AI application based on the established supabase_schema.sql.

---

1. User Management

Core Tables: profiles

Authentication & Profiles: Supabase Auth handles standard login/registration. A trigger or frontend API call mirrors the authenticated user into the profiles table. LearnSync AI operates under a single user role: student. There is no instructor or administrative user role in this application.

---

2. Study Spaces

Core Tables: study_spaces, materials

Study Space Creation: Students create their own study spaces. Each study space serves as a self-contained learning environment and contains five functional tabs:

  - Flashcards
  - Free Recall
  - Feynman Technique
  - Test Mode
  - Course Resources

Space Sharing (Peer-to-Peer): A student may toggle is_published = true on their study space to share it with peers. Once published, Row-Level Security (RLS) policies grant other students strict read-only SELECT access to the space, its flashcards, and its learning resources. Peers cannot modify the original author's workspace.

---

3. Document Parsing & Semantic Storage (Course Resources Tab)

Core Tables: materials, concepts
AI Integration: Gemini API (text-embedding-004)

Upload Flow:
  1. Student uploads a PDF or other learning resource inside the Course Resources tab of their study space.
  2. Backend inserts a record into materials with parsed_status = 'pending'.

Processing Flow (Background Job):
  - A backend worker detects the pending material.
  - Extracts text from the document.
  - Uses Gemini/LLM to extract key terms and definitions.
  - Calls Gemini Embeddings API to convert definitions into vector(768).
  - Inserts these into the concepts table.
  - Updates materials to completed.

AI Chatbot: The Course Resources tab also hosts an integrated AI chatbot. Students can submit natural language questions about their uploaded materials. The backend performs semantic similarity search via pgvector against the stored concept embeddings, retrieves relevant context, and passes it to the LLM (Retrieval-Augmented Generation) to produce a grounded, context-aware answer.

---

4. Flashcards with Spaced Repetition & BKT

Core Tables: flashcard_decks, flashcards, bkt_mastery
AI Integration: Gemini (text generation for auto-generation)

Flashcard Flow:
  - Students create flashcard decks within their study space.
  - They can manually add cards or use the AI auto-generation feature, which uses the uploaded materials in the Course Resources tab to automatically generate relevant flashcard content.

Spaced Repetition Logic (Student Rating):
  - When a student flips a card, they self-rate their recall difficulty:
      * Easy   → card is scheduled to reappear after 4 days
      * Medium → card is scheduled to reappear after 3 days
      * Hard   → card is scheduled to reappear after 1 day
  - The next_review_at timestamp on the flashcard record is updated accordingly.

BKT Integration:
  - On each card rating event, a BKT recalculation is triggered for the corresponding concept.
  - The BKT Microservice updates the student's latent_mastery in bkt_mastery for that concept, reflecting their updated knowledge state.
  - Future adaptive features (test difficulty, game difficulty) consume this updated mastery value.

---

5. Free Recall

Core Tables: cognitive_logs, concepts
AI Integration: Gemini Embeddings & Gemini (Text Generation)

Logic Flow:
  - Student is prompted to type all the information they remember from their studied materials, without looking at any notes.
  - Student submits user_input (free-form text).
  - Scoring: Backend converts user_input to a vector via Gemini Embeddings API. It runs a pgvector cosine similarity query (<=>) comparing the student's vector against the reference concept vectors. The resulting cosine similarity score is stored as similarity_score.
  - AI Feedback: Backend sends the reference material context and the student's input to Gemini, prompting it to:
      * Identify which concepts the student missed entirely.
      * Flag areas where their understanding was incomplete or unclear.
      * Provide constructive, actionable feedback.
  - The ai_feedback text and similarity_score are stored in cognitive_logs and returned to the UI.

---

6. Feynman Technique

Core Tables: cognitive_logs
AI Integration: Gemini (Text Generation)

Logic Flow:
  - Student is prompted to explain a concept from their uploaded materials in their own words, as if teaching a 5-year-old or explaining it to themselves.
  - Student submits their explanation text.
  - AI Evaluation: Backend sends the student's explanation along with the reference concept definition to Gemini, prompting it to evaluate:
      * Whether the student has correctly understood the core concept.
      * Where the explanation is vague, incorrect, or missing important details.
  - Gemini returns structured feedback indicating the quality of the student's conceptual understanding.
  - The ai_feedback is stored in cognitive_logs and surfaced to the student.

---

7. Test Mode (Adaptive BKT Testing)

Core Tables: practice_tests, practice_telemetry, bkt_mastery
Background Service: Python BKT Microservice
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
  - Backend instructs the LLM: "Concept A mastery is 0.9 (generate harder questions). Concept B mastery is 0.2 (generate easier questions)."
  - LLM generates questions matching the selected question types and the student's adaptive difficulty profile. Questions are saved to practice_tests.

Taking the Test & Telemetry:
  - As the student answers questions, the frontend records is_correct and latency_ms and sends them to practice_telemetry.

BKT Recalculation Loop:
  - After test submission, the BKT Microservice reads the new practice_telemetry data.
  - It recalculates the probability of mastery for each relevant concept.
  - It updates bkt_mastery. All future practice tests will adapt to this new mastery level, generating progressively harder or easier questions depending on performance trends.

---

8. Gamification (PlayMe Module)

Core Tables: game_sessions, gamification_profiles, user_badges
AI Integration: Gemini (Content Generation for game content)

Games Available:
  - Crossword: AI generates a crossword puzzle from vocabulary and key terms extracted from the student's uploaded materials.
  - Term Matching: AI generates term-definition pairs for a card matching game based on study space content.
  - Timed Trivia: AI generates timed trivia questions drawn from the student's learning resources.

BKT-Adaptive Difficulty:
  - Game content difficulty is dynamically adjusted based on the student's BKT mastery score.
  - When a student's mastery for a concept is at or below 50%, the game generates content calibrated to that knowledge level, reinforcing foundational understanding before advancing difficulty.

Session Logging:
  - When a game session concludes, the frontend posts final stats (game_type, xp_earned, accuracy, time_spent_ms) to game_sessions.

Database Autopilot (Triggers):
  - An AFTER INSERT PostgreSQL trigger intercepts the new game session.
  - It updates gamification_profiles (XP, total hours studied).
  - Streak Logic: If the student's last active timestamp was less than 48 hours ago, current_streak += 1 (day streak increments). If more than 48 hours have elapsed, current_streak resets to 1.
  - The trigger also accumulates total hours studied across all activity types (flashcards, games, recall sessions, etc.).

Streaks:
  - The application tracks two streak dimensions:
      * Day Streaks: Consecutive days a student has engaged with any study activity (flashcards, games, etc.). Example: using flashcards or crossword games for 5 consecutive days results in a 5-day streak.
      * Total Hours: Cumulative time spent studying, tracked across all modules.

Badges:
  - Badges are awarded based on milestone achievements, evaluated by backend cron jobs or trigger-based endpoint checks.
  - Example: A student achieving a 5-day streak on flashcards earns a Flashcard Streak badge.
  - Badge records are inserted into user_badges upon milestone completion.

---

9. Peer-to-Peer Resource Sharing (CollabShare)

Core Tables: study_spaces, flashcard_decks, flashcards, materials

Logic Flow:
  - A student publishes their study space by toggling is_published = true.
  - RLS policies instantly unlock SELECT access for other students to view the space, its flashcard decks, flashcards, and course resources.
  - Peers have strict read-only access. They cannot modify the original author's content.
  - Peers may clone individual resources (e.g., flashcard decks) from a shared space into their own profile under their unique user ID, enabling personal customization of the cloned content without affecting the original.