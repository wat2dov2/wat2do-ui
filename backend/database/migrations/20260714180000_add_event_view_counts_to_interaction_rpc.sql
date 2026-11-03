-- Migration: add_event_view_counts_to_interaction_rpc
-- Created: 2026-07-14
--
-- Replace click-only enrichment with a combined interaction-count RPC so event
-- cards can show views alongside clicks.

BEGIN;

DROP FUNCTION IF EXISTS public.get_event_click_counts(integer[]);

CREATE OR REPLACE FUNCTION public.get_event_interaction_counts(p_event_ids integer[])
RETURNS TABLE(event_id integer, click_count bigint, view_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    ui.event_id,
    COUNT(*) FILTER (WHERE ui.interaction_type = 'click')::bigint AS click_count,
    COUNT(*) FILTER (WHERE ui.interaction_type = 'view')::bigint AS view_count
  FROM public.user_interactions AS ui
  WHERE ui.event_id = ANY(p_event_ids)
    AND ui.interaction_type IN ('click', 'view')
  GROUP BY ui.event_id;
$$;

REVOKE ALL ON FUNCTION public.get_event_interaction_counts(integer[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_event_interaction_counts(integer[]) FROM anon;
REVOKE ALL ON FUNCTION public.get_event_interaction_counts(integer[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_event_interaction_counts(integer[]) TO service_role;

COMMIT;
