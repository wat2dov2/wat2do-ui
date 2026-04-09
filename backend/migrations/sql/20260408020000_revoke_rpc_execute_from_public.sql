-- Migration: revoke RPC execute from public
-- Created: 2026-04-08
--
-- Security fix: revoke EXECUTE on public-schema RPC functions from anon,
-- authenticated, and the public pseudo-role.
--
-- PostgreSQL grants EXECUTE to PUBLIC by default on new functions.
-- Supabase exposes public-schema functions via PostgREST at /rpc/<name>,
-- meaning any holder of the anon or authenticated key could call
-- adjust_credits, ensure_user_credits, or promote_event directly —
-- bypassing FastAPI auth, rate limiting, and server-side pricing logic.
--
-- After this migration only service_role (used by the FastAPI backend)
-- and the database owner (postgres) can execute these functions.

-- ensure_user_credits
REVOKE EXECUTE ON FUNCTION public.ensure_user_credits(UUID, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ensure_user_credits(UUID, INTEGER) FROM anon;
REVOKE EXECUTE ON FUNCTION public.ensure_user_credits(UUID, INTEGER) FROM authenticated;

-- adjust_credits
REVOKE EXECUTE ON FUNCTION public.adjust_credits(UUID, INTEGER, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.adjust_credits(UUID, INTEGER, INTEGER) FROM anon;
REVOKE EXECUTE ON FUNCTION public.adjust_credits(UUID, INTEGER, INTEGER) FROM authenticated;

-- promote_event
REVOKE EXECUTE ON FUNCTION public.promote_event(UUID, INTEGER, VARCHAR, INTEGER, INTEGER, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.promote_event(UUID, INTEGER, VARCHAR, INTEGER, INTEGER, INTEGER) FROM anon;
REVOKE EXECUTE ON FUNCTION public.promote_event(UUID, INTEGER, VARCHAR, INTEGER, INTEGER, INTEGER) FROM authenticated;

-- Explicitly grant to service_role so the FastAPI backend (which uses the
-- service-role key) can still call these via the Supabase Python SDK.
GRANT EXECUTE ON FUNCTION public.ensure_user_credits(UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.adjust_credits(UUID, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.promote_event(UUID, INTEGER, VARCHAR, INTEGER, INTEGER, INTEGER) TO service_role;
