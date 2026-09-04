-- ============================================================
-- 0027 · Per-deck "show the answer first" setting
-- ============================================================
--
-- A flashcard's front is the educator's term (or a generated question) and its
-- back is the educator's definition. Recalling a definition from a term and
-- recalling a term from a definition are different drills, and only the first
-- was possible: nothing in the product could reverse the two faces.
--
-- ══ WHY A COLUMN ON THE DECK ══
-- A deck belongs to exactly one student (`flashcard_decks.space_id` →
-- `study_spaces.student_id`), so a column here IS a per-student setting — no
-- join, no second table, no preferences bag. It is also the right GRAIN: a
-- question-format deck reads oddly reversed while a term-format deck reads very
-- well reversed, so one switch covering every deck would be worse than none.
--
-- This is not the `onboarding_seen` shape (migration 0026) and should not be.
-- That is a SET of keys with no natural home row; this is one boolean about one
-- row that already exists.
--
-- ⚠️ IT CHANGES NOTHING BUT WHICH SIDE IS SHOWN FIRST. The stored `term` and
-- `definition` are untouched, the back of a card is still the educator's words
-- verbatim, and `POST /api/flashcards/rate`, `spaced_repetition_logs`,
-- `bkt_mastery` and `activity_logs` are all unaffected. No route reads this to
-- make a decision — it is a display preference only.
--
-- ══ NO RLS CHANGE ══
-- `flashcard_decks` already carries "Students manage their own decks" FOR ALL
-- with `private.owns_study_space(space_id)` on both USING and WITH CHECK, which
-- covers a new column automatically. Express writes with the service role and
-- bypasses RLS regardless.
--
-- SAFE TO RE-RUN. Applied by hand in the Supabase SQL editor; there is no runner
-- in this repo.

ALTER TABLE public.flashcard_decks
    ADD COLUMN IF NOT EXISTS answer_first BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.flashcard_decks.answer_first IS
    'Display preference: true shows the definition (the answer) on the first face and the term/question on the reverse, in both the card grid and the study session. Written only by PUT /api/spaces/:id/decks/:deckId. Affects nothing but rendering -- no score, schedule or mastery path reads it.';
