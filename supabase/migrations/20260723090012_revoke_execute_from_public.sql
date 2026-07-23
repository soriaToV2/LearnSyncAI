-- ============================================================================
-- 0012 — Revoke helper-function EXECUTE from PUBLIC
-- ============================================================================
-- Migration 0010 revoked EXECUTE from `anon` and `authenticated`, but
-- PostgreSQL grants EXECUTE on every new function to PUBLIC by default, and
-- both roles inherit it from there. The helpers stayed reachable as PostgREST
-- RPC endpoints (/rest/v1/rpc/auth_role, ...).
--
-- Revoking from PUBLIC as well closes them. Verified that RLS policy
-- expressions and trigger functions still evaluate correctly afterwards: neither
-- re-checks the caller's EXECUTE privilege.
-- ============================================================================

REVOKE EXECUTE ON FUNCTION public.auth_role()                  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.auth_grade_level()           FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.auth_assigned_grades()       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.owns_study_space(UUID)       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_profile_immutables() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user()            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_study_streak()        FROM PUBLIC, anon, authenticated;
