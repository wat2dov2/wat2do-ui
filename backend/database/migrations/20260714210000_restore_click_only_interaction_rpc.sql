-- Migration: restore_click_only_interaction_rpc
-- Created: 2026-07-14
--
-- Drop view-count enrichment. Event cards only care about clicks.

BEGIN;

DROP FUNCTION IF EXISTS public.get_event_interaction_counts(integer[]);

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
