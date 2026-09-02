-- ============================================================
-- 0025 · Drop the Pre-Test / Post-Test research instrument
-- ============================================================
--
-- Migration 0024 built `material_assessments` and `assessment_attempts` to serve
-- the paper's RQ4 (p. 55) — the difference between a student's standard pre-test
-- score and their post-test score. That instrument was withdrawn on advice: the
-- student-usage window of the school study is ONE WEEK, which is too short for a
-- pre/post delta to be attributable to the platform.
--
-- The replacement is the BKT mastery the platform already tracks, exported per
-- student from `GET /api/educator/materials/:id/mastery-evidence` (built on
-- `bkt_mastery` + `bkt_update_logs`, both untouched by this migration).
--
-- NOTHING ELSE IN THE SCHEMA POINTS AT EITHER TABLE. Both FKs on each ran
-- outward — to `materials`, `profiles` and to each other — and no view, function
-- or trigger referenced them. `bkt_source` and `activity_type` were deliberately
-- never given a value for this feature, so there is no enum to revert here.
--
-- The five attempt rows that existed all belonged to developer test accounts and
-- were archived to `LearnSyncAI artifacts/prepost-attempts-archive-2026-09-02.csv`
-- before this ran. No school-study data was ever collected through the feature.
--
-- Order matters: `assessment_attempts.assessment_id` references
-- `material_assessments`, so the child goes first.

DROP TABLE IF EXISTS assessment_attempts;
DROP TABLE IF EXISTS material_assessments;
DROP TYPE  IF EXISTS assessment_phase;
