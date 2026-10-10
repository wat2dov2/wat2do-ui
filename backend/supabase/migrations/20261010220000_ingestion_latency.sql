BEGIN;

-- How quickly the ingestion agent catches Instagram posts. A new event's
-- delay is added_at minus source_posted_at; an update's delay is
-- last_source_changed_at minus last_source_posted_at.
ALTER TABLE public.events
    ADD COLUMN IF NOT EXISTS source_posted_at timestamptz,
    ADD COLUMN IF NOT EXISTS last_source_posted_at timestamptz,
    ADD COLUMN IF NOT EXISTS last_source_changed_at timestamptz;

CREATE INDEX IF NOT EXISTS events_source_posted_added_idx
    ON public.events (added_at) WHERE source_posted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS events_last_source_changed_idx
    ON public.events (last_source_changed_at) WHERE last_source_posted_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.stamp_ingestion_agent_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    -- Only an agent change that names its new source post counts as a catch.
    IF session_user = 'wat2do_ingest_agent'
        AND NEW.last_source_posted_at IS DISTINCT FROM OLD.last_source_posted_at
    THEN
        NEW.last_source_changed_at := now();
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stamp_ingestion_agent_change ON public.events;
CREATE TRIGGER stamp_ingestion_agent_change BEFORE UPDATE ON public.events
    FOR EACH ROW EXECUTE FUNCTION public.stamp_ingestion_agent_change();

-- One row per Instagram catch since p_since: a new event or an update.
CREATE OR REPLACE FUNCTION public.ingestion_latencies(p_since timestamptz)
RETURNS TABLE (school text, kind text, caught_at timestamptz, latency_seconds double precision)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT school.slug, 'new', event.added_at,
        extract(epoch FROM event.added_at - event.source_posted_at)
    FROM public.events AS event
    JOIN public.schools AS school ON school.id = event.school_id
    WHERE event.source_posted_at IS NOT NULL
        AND event.added_at >= p_since
        AND event.added_at >= event.source_posted_at
    UNION ALL
    SELECT school.slug, 'update', event.last_source_changed_at,
        extract(epoch FROM event.last_source_changed_at - event.last_source_posted_at)
    FROM public.events AS event
    JOIN public.schools AS school ON school.id = event.school_id
    WHERE event.last_source_posted_at IS NOT NULL
        AND event.last_source_changed_at >= p_since
        AND event.last_source_changed_at >= event.last_source_posted_at
        -- The post that created the event is its "new" catch, not an update.
        AND event.last_source_posted_at IS DISTINCT FROM event.source_posted_at;
$$;
REVOKE ALL ON FUNCTION public.ingestion_latencies(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingestion_latencies(timestamptz) TO service_role;

COMMIT;
