-- ============================================================================
-- 0018 — Educators own their uploads outright; admin returns to accounts only
-- ============================================================================
-- Migration 0017 handed grade selection to the educator but left the subject
-- gated: an admin had to record which subjects a teacher handles, and
-- enforce_material_publish_scope() rejected anything filed under a subject
-- outside that list.
--
-- That gate buys nothing in practice. A teacher does not upload material for a
-- subject they do not teach in the actual classroom, so the table encoded a
-- constraint reality already enforces — while adding a mandatory admin step
-- before any new educator could upload at all. A fresh account was inert until
-- someone remembered to assign it subjects.
--
-- It also overshot the specification. ARCHITECTURE.md section 1 scopes the admin
-- to "creating, editing, disabling accounts" and states the role "does not
-- interact with learning content"; the educator is the one who "assigns
-- grade-level access controls". Subject assignment was neither.
--
-- After this migration the educator chooses subject AND grade levels per upload,
-- and the admin manages accounts and nothing else.
--
-- Deliberately kept:
--   * public.subjects — still the controlled vocabulary behind materials.subject,
--     so 'Science' / 'science' / 'Sci' cannot fragment dashboard grouping. It is
--     a school-wide catalogue, not a per-educator permission.
--   * private.auth_assigned_grades() — already derives from the educator's own
--     materials (migration 0017), so analytics scope is untouched by this change.
-- ============================================================================

DROP TRIGGER trg_materials_publish_scope ON materials;
DROP FUNCTION enforce_material_publish_scope();

-- The table's two RLS policies are dropped along with it.
DROP TABLE educator_assignments;

COMMENT ON COLUMN materials.subject IS
    'Subject this material is filed under, from the subjects catalogue. Chosen by the uploading educator.';
