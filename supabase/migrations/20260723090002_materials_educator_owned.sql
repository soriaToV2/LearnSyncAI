-- ============================================================================
-- 0002 — Materials become educator-owned and grade-scoped
-- ============================================================================
-- Under the version-4 model only authenticated educators upload learning
-- resources, and each upload is scoped to one or more JHS grade levels. A
-- material is no longer owned by a student's study space; the link to study
-- spaces moves to a join table in migration 0003.
--
-- The documented ingest limits (20 MB plain-text PDF, 20 pages scanned PDF)
-- are enforced as CHECK constraints so they cannot be bypassed by a caller.
-- ============================================================================

-- 1. parsed_status gains 'failed' ---------------------------------------------
-- materials.routes.ts writes 'failed' when Gemini extraction throws, but the
-- live enum never had that value, so failed uploads were stuck in 'processing'.
-- Rebuilt rather than ALTER TYPE ... ADD VALUE so the change is transactional.

CREATE TYPE parsed_status_new AS ENUM ('pending', 'processing', 'completed', 'failed');

ALTER TABLE materials ALTER COLUMN parsed_status DROP DEFAULT;

ALTER TABLE materials
    ALTER COLUMN parsed_status TYPE parsed_status_new
    USING parsed_status::text::parsed_status_new;

ALTER TABLE materials ALTER COLUMN parsed_status SET DEFAULT 'pending'::parsed_status_new;

DROP TYPE parsed_status;
ALTER TYPE parsed_status_new RENAME TO parsed_status;

-- 2. uploader_id -> educator_id ------------------------------------------------

ALTER TABLE materials RENAME COLUMN uploader_id TO educator_id;

ALTER TABLE materials DROP CONSTRAINT materials_uploader_id_fkey;

-- Legacy rows were uploaded by a student under the old model. Materials must
-- belong to an educator, so hand them to the earliest educator account.
UPDATE materials
   SET educator_id = (
        SELECT id FROM profiles WHERE role = 'educator' ORDER BY created_at LIMIT 1
   )
 WHERE educator_id IS NULL
    OR educator_id IN (SELECT id FROM profiles WHERE role <> 'educator');

ALTER TABLE materials
    ALTER COLUMN educator_id SET NOT NULL,
    ADD CONSTRAINT materials_educator_id_fkey
        FOREIGN KEY (educator_id) REFERENCES profiles(id) ON DELETE RESTRICT;

COMMENT ON COLUMN materials.educator_id IS
    'Educator who uploaded this material. RESTRICT: an educator with materials cannot be deleted.';

-- 3. Grade-level access control + file metadata --------------------------------

ALTER TABLE materials
    ADD COLUMN grade_levels    SMALLINT[],
    ADD COLUMN description     TEXT,
    ADD COLUMN subject         TEXT,
    ADD COLUMN file_size_bytes BIGINT,
    ADD COLUMN page_count      INTEGER,
    ADD COLUMN is_scanned      BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN parse_error     TEXT,
    ADD COLUMN is_archived     BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN updated_at      TIMESTAMPTZ NOT NULL DEFAULT now();

-- Legacy materials predate grade scoping: expose them to every JHS grade so
-- existing test data stays reachable.
UPDATE materials
   SET grade_levels = ARRAY[7, 8, 9, 10]::SMALLINT[]
 WHERE grade_levels IS NULL;

ALTER TABLE materials
    ALTER COLUMN grade_levels SET NOT NULL,

    ADD CONSTRAINT materials_grade_levels_valid
        CHECK (grade_levels <@ ARRAY[7, 8, 9, 10]::SMALLINT[]
               AND array_length(grade_levels, 1) >= 1),

    -- Documented ingest limit: plain-text PDF modules up to 20 MB.
    ADD CONSTRAINT materials_file_size_limit
        CHECK (file_size_bytes IS NULL OR file_size_bytes <= 20971520),

    -- Documented ingest limit: scanned/image-based PDFs up to 20 pages.
    ADD CONSTRAINT materials_scanned_page_limit
        CHECK (NOT is_scanned OR page_count IS NULL OR page_count <= 20),

    ADD CONSTRAINT materials_page_count_positive
        CHECK (page_count IS NULL OR page_count > 0);

COMMENT ON COLUMN materials.grade_levels IS
    'JHS grade levels allowed to access this material. Drives student-side RLS.';
COMMENT ON COLUMN materials.is_scanned IS
    'True for image-based/scanned PDFs, which are limited to 20 pages.';
COMMENT ON COLUMN materials.parse_error IS
    'Populated alongside parsed_status = failed so the educator sees why ingestion failed.';

-- 4. Indexes + updated_at ------------------------------------------------------

CREATE INDEX idx_materials_educator     ON materials (educator_id);
CREATE INDEX idx_materials_grade_levels ON materials USING GIN (grade_levels);
CREATE INDEX idx_materials_status       ON materials (parsed_status) WHERE NOT is_archived;

CREATE TRIGGER trg_materials_updated_at
    BEFORE UPDATE ON materials
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
