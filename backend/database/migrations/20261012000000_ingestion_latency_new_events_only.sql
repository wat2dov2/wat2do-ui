BEGIN;

-- Latency now only measures how long a new event takes to reach wat2do
-- after its Instagram post goes up (added_at minus source_posted_at), so
-- the update tracking goes away. The last_source_posted_at and
-- last_source_changed_at columns stay until no running build writes them;
-- a later migration drops them.
DROP TRIGGER IF EXISTS stamp_ingestion_agent_change ON public.events;
DROP FUNCTION IF EXISTS public.stamp_ingestion_agent_change();
DROP INDEX IF EXISTS public.events_last_source_changed_idx;

-- One row per event added from an Instagram post since p_since.
DROP FUNCTION IF EXISTS public.ingestion_latencies(timestamptz);
CREATE FUNCTION public.ingestion_latencies(p_since timestamptz)
RETURNS TABLE (school text, added_at timestamptz, latency_seconds double precision)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT school.slug, event.added_at,
        extract(epoch FROM event.added_at - event.source_posted_at)
    FROM public.events AS event
    JOIN public.schools AS school ON school.id = event.school_id
    WHERE event.source_posted_at IS NOT NULL
        AND event.added_at >= p_since
        AND event.added_at >= event.source_posted_at;
$$;
REVOKE ALL ON FUNCTION public.ingestion_latencies(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingestion_latencies(timestamptz) TO service_role;

COMMIT;
