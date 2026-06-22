LearnSync AI: Backend Architecture & Logic Guide

Target Audience: AI Developer Agents, Backend Engineers, Full-Stack Developers.
Purpose: To explain the logical data flow, AI integration points, and database interactions for every major feature in the LearnSync AI application based on the established supabase_schema.sql.

1. User Management & Course Enrollment (RBAC)

Core Tables: profiles, courses, enrollments, course_announcements

Authentication & Profiles: Supabase Auth handles standard login. A trigger (to be implemented in auth) or frontend API call must mirror the user into the profiles table, assigning an ENUM role (student or instructor).

Course Creation: Instructors create records in courses. They can generate a unique join_code.

Enrollment: Students submit a join_code -> backend verifies -> creates a record in enrollments.

Announcements: Instructors insert into course_announcements. Row-Level Security (RLS) automatically ensures students only SELECT announcements where they have an active enrollment.

2. Document Parsing & Semantic Storage

Core Tables: materials, concepts
AI Integration: Gemini API (text-embedding-004)

Upload Flow: 1. Instructor uploads a PDF/PPT to Supabase Storage.
2. Backend inserts a record into materials with parsed_status = 'pending'.

Processing Flow (Background Job):

A backend worker detects the pending material.

Extracts text from the document.

Uses Gemini/LLM to extract key terms and definitions.

Calls Gemini Embeddings API to convert definitions into vector(768).

Inserts these into the concepts table.

Updates materials to completed.

3. Summative Pathway (Official Assessments & Isomorphic Features)

Core Tables: assessments, assessment_sets, assessment_submissions

Generation Flow:

Instructor defines exam parameters (type, time, sources, number of sets) in assessments.

Backend queries concepts from the selected source_material_ids.

Isomorphic Generation: If the instructor requests multiple sets (e.g., number_of_sets = 2), the backend prompts the LLM to generate isomorphic variations (e.g., Set A and Set B). These sets test the exact same concepts and difficulty levels but use different scenarios, values, or wording to prevent student cheating.

Each generated set's payload is saved as a separate record into assessment_sets (questions_payload JSONB).

Deployment & Submissions:

Instructor changes assessment status to deployed.

Students fetch their randomly or sequentially assigned assessment_sets payload, take the exam on the frontend, and submit.

Backend inserts the final answers into assessment_submissions.

Security: RLS enforces "Write-Once, Read-Only, No Updates". Submissions are immutable to prevent cheating.

4. Formative Pathway: CollabShare & Flashcards

Core Tables: study_spaces, flashcard_decks, flashcards

Study Space Initialization: Every student creates study_spaces tied to a course.

Flashcard Flow: Students create organizational flashcard_decks. They (or the AI) populate flashcards linked to that deck_id.

CollabShare (Publishing):

Student toggles is_published = true on a study space.

RLS policies instantly unlock SELECT access for peers to view the space, its decks, and its flashcards.

5. Cognitive Review (Free Recall & Feynman Technique)

Core Tables: cognitive_logs, concepts
AI Integration: Gemini Embeddings & Gemini 1.5 Flash (Text Generation)

Logic Flow:

Student is prompted to explain a specific concept_id in their own words.

Student submits user_input.

Scoring: Backend converts user_input to a vector via Gemini API. It runs a SQL query using pgvector (<=> operator) comparing the student's vector to the true concept's vector. The resulting cosine similarity is stored as similarity_score.

Coaching: Backend sends the true definition and the student's input to Gemini 1.5 Flash, prompting for constructive feedback.

The text feedback is stored in ai_feedback. Both score and feedback are returned to the UI.

6. Adaptive Testing (Bayesian Knowledge Tracing - BKT)

Core Tables: practice_tests, practice_telemetry, bkt_mastery
Background Service: Python BKT Microservice

Pre-Test Generation:

Student requests a practice test for specific materials.

Backend queries bkt_mastery to get the student's latent_mastery (0.0 - 1.0) for the relevant concept_ids.

Backend passes these scores to the LLM: "Concept A mastery is 0.9 (make it hard). Concept B mastery is 0.2 (make it easy)."

LLM generates questions; saved to practice_tests.

Taking the Test & Telemetry:

As the student answers, frontend sends is_correct and latency_ms to practice_telemetry.

BKT Recalculation Loop:

After the test, the BKT Microservice reads the new practice_telemetry data.

It recalculates the probability of mastery.

It updates bkt_mastery. Future practice tests will now adapt to this new mastery level.

7. Gamification (PlayMe Module)

Core Tables: game_sessions, gamification_profiles, user_badges

Decoupled Architecture: Games (Term Matcher, Crossword, Trivia Blast, Boggle) are rendered and played entirely on the frontend to ensure zero latency.

Session Logging: When a game concludes, the frontend posts the final stats (game_type, xp_earned, accuracy, time_spent_ms) to game_sessions.

Database Autopilot (Triggers):

An AFTER INSERT PostgreSQL trigger intercepts the new game session.

It updates gamification_profiles.

It calculates streak logic: If the last active time was < 48 hours ago, current_streak += 1. If > 48 hours, current_streak = 1. It also adds the newly earned XP.

Badges: Backend chron jobs or specific endpoint checks evaluate total XP/streaks to award user_badges.

8. Automated Notifications

Core Tables: notifications

Trigger-Driven Architecture: The application code does not handle notification dispatching. It is entirely handled by PostgreSQL triggers.

Logic:

When an INSERT happens on course_announcements OR materials, OR an UPDATE to deployed happens on assessments.

The trigger executes a SELECT against the enrollments table for the matching course_id.

It automatically bulk-inserts a new unread notification into the notifications table for every single enrolled student_id.