BEGIN;

-- A place without looked_up_at is waiting for its first lookup. One backend
-- worker claims one place at a time, because Nominatim's usage policy allows
-- the whole app one request a second.
ALTER TABLE public.map_locations ALTER COLUMN looked_up_at DROP NOT NULL;
ALTER TABLE public.map_locations ALTER COLUMN looked_up_at DROP DEFAULT;
ALTER TABLE public.map_locations ADD COLUMN IF NOT EXISTS claimed_until timestamptz;
CREATE INDEX IF NOT EXISTS map_locations_waiting_idx
    ON public.map_locations (looked_up_at NULLS FIRST) WHERE coordinates IS NULL;
CREATE INDEX IF NOT EXISTS map_locations_claimed_idx
    ON public.map_locations (claimed_until) WHERE claimed_until IS NOT NULL;

-- Every place an event names waits for a lookup, whoever writes the event.
CREATE OR REPLACE FUNCTION public.queue_event_map_location()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.map_locations (school_id, map_location)
    VALUES (NEW.school_id, NEW.map_location)
    ON CONFLICT (school_id, map_location) DO NOTHING;
    RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.queue_event_map_location() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS queue_event_map_location ON public.events;
CREATE TRIGGER queue_event_map_location
    AFTER INSERT OR UPDATE OF map_location, school_id ON public.events
    FOR EACH ROW
    WHEN (NEW.map_location IS NOT NULL AND NEW.school_id IS NOT NULL)
    EXECUTE FUNCTION public.queue_event_map_location();

-- The next waiting place, unless another worker is still looking one up.
-- Places never found wait again once they were last tried before p_retry_before.
CREATE OR REPLACE FUNCTION public.claim_map_location(
    p_lease_seconds integer,
    p_retry_before timestamptz
)
RETURNS SETOF public.map_locations
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('public.claim_map_location'));
    IF EXISTS (SELECT 1 FROM public.map_locations WHERE claimed_until > now()) THEN
        RETURN;
    END IF;
    RETURN QUERY
    UPDATE public.map_locations AS place
    SET claimed_until = now() + make_interval(secs => p_lease_seconds)
    WHERE (place.school_id, place.map_location) = (
        SELECT waiting.school_id, waiting.map_location
        FROM public.map_locations AS waiting
        WHERE waiting.coordinates IS NULL
            AND (waiting.looked_up_at IS NULL OR waiting.looked_up_at < p_retry_before)
        ORDER BY waiting.looked_up_at NULLS FIRST, waiting.school_id, waiting.map_location
        LIMIT 1
    )
    RETURNING place.*;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_map_location(integer, timestamptz)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_map_location(integer, timestamptz) TO service_role;

-- Places of events still to come wait now; later events queue their own.
INSERT INTO public.map_locations (school_id, map_location)
SELECT DISTINCT event.school_id, event.map_location
FROM public.events AS event
WHERE event.map_location IS NOT NULL
    AND event.school_id IS NOT NULL
    AND EXISTS (
        SELECT 1
        FROM public.event_dates AS occurrence
        WHERE occurrence.event_id = event.id
            AND occurrence.dtstart_utc > now() - interval '1 day'
    )
ON CONFLICT (school_id, map_location) DO NOTHING;

COMMIT;
