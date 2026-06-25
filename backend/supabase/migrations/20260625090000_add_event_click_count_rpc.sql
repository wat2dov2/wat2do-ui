-- Migration: add_event_click_count_rpc
-- Created: 2026-06-25
--
-- Backend-only aggregate used to enrich event cards with click counts without
-- fetching raw user_interactions rows into Python.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_event_click_counts(p_event_ids integer[])
RETURNS TABLE(event_id integer, click_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ui.event_id, COUNT(*)::bigint AS click_count
  FROM public.user_interactions AS ui
  WHERE ui.event_id = ANY(p_event_ids)
    AND ui.interaction_type = 'click'
  GROUP BY ui.event_id;
$$;

REVOKE ALL ON FUNCTION public.get_event_click_counts(integer[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_event_click_counts(integer[]) FROM anon;
REVOKE ALL ON FUNCTION public.get_event_click_counts(integer[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_event_click_counts(integer[]) TO service_role;

COMMIT;
