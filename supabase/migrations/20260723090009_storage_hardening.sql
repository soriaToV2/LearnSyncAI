-- ============================================================================
-- 0009 — Storage hardening for the `materials` bucket
-- ============================================================================
-- The bucket was public, 50 MB, and accepted any MIME type. A public bucket
-- serves every uploaded PDF to anyone who knows the object path, which defeats
-- the grade-level access control the rest of this schema enforces.
--
-- The backend already reads files through createSignedUrl() (service role), so
-- making the bucket private requires no application change.
-- ============================================================================

UPDATE storage.buckets
   SET public             = false,
       file_size_limit    = 20971520,                      -- 20 MB, doc p.59
       allowed_mime_types = ARRAY['application/pdf']
 WHERE id = 'materials';

-- Object-level policies mirroring the `materials` table rules.
-- Reads resolve through materials.storage_path so they work for objects
-- uploaded under the old path scheme as well.

DROP POLICY IF EXISTS "Educators upload their own materials"      ON storage.objects;
DROP POLICY IF EXISTS "Educators manage their own material files" ON storage.objects;
DROP POLICY IF EXISTS "Educators read their own material files"   ON storage.objects;
DROP POLICY IF EXISTS "Students read materials for their grade"   ON storage.objects;

-- Writes are keyed on a leading <educator_id>/ folder, so the check does not
-- depend on a materials row that does not exist yet at upload time.
CREATE POLICY "Educators upload their own materials"
    ON storage.objects FOR INSERT
    WITH CHECK (
        bucket_id = 'materials'
        AND public.auth_role() = 'educator'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

CREATE POLICY "Educators manage their own material files"
    ON storage.objects FOR DELETE
    USING (
        bucket_id = 'materials'
        AND EXISTS (
            SELECT 1 FROM public.materials m
             WHERE m.storage_path = storage.objects.name
               AND m.educator_id = auth.uid()
        )
    );

CREATE POLICY "Educators read their own material files"
    ON storage.objects FOR SELECT
    USING (
        bucket_id = 'materials'
        AND EXISTS (
            SELECT 1 FROM public.materials m
             WHERE m.storage_path = storage.objects.name
               AND m.educator_id = auth.uid()
        )
    );

CREATE POLICY "Students read materials for their grade"
    ON storage.objects FOR SELECT
    USING (
        bucket_id = 'materials'
        AND EXISTS (
            SELECT 1 FROM public.materials m
             WHERE m.storage_path = storage.objects.name
               AND NOT m.is_archived
               AND public.auth_grade_level() = ANY (m.grade_levels)
        )
    );
