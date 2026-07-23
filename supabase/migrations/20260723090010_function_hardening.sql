-- ============================================================================
-- 0010 — Function hardening
-- ============================================================================
-- Closes two classes of Supabase security-linter warning:
--
--   1. SECURITY DEFINER helpers were reachable as PostgREST RPC endpoints
--      (/rest/v1/rpc/auth_role and friends) by anon and authenticated.
--      EXECUTE is revoked from both roles. Verified that this does not break
--      anything: RLS policy expressions and trigger functions are evaluated
--      without re-checking the caller's EXECUTE privilege, so grade-level
--      filtering, ownership checks and the streak trigger all still work.
--
--   2. Four functions had a role-mutable search_path, which lets a caller
--      shadow the objects they reference.
-- ============================================================================

-- 1. Take the SECURITY DEFINER helpers off the public API ----------------------

REVOKE EXECUTE ON FUNCTION public.auth_role()                    FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.auth_grade_level()             FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.auth_assigned_grades()         FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.owns_study_space(UUID)         FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_profile_immutables()   FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user()              FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_study_streak()          FROM anon, authenticated;

-- 2. Pin search_path on the remaining functions --------------------------------

ALTER FUNCTION public.document_mastery(UUID, UUID)        SET search_path = public;
ALTER FUNCTION public.mastery_tier(NUMERIC)               SET search_path = public;
ALTER FUNCTION public.update_updated_at_column()          SET search_path = public;
ALTER FUNCTION public.match_concepts(vector, uuid[], int, float) SET search_path = public;

-- Note on the remaining `extension_in_public` advisory: pgvector lives in the
-- public schema. Relocating it would require rewriting concepts.embedding
-- (vector(3072)) and every function signature that mentions `vector`, for no
-- practical security gain, so it is deliberately left in place.
