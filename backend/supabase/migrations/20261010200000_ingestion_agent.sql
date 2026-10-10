BEGIN;

-- The local Haiku ingestion agent reads and writes events and positions
-- directly through this role. It cannot touch any other table; it may only
-- read clubs and schools to resolve hosts. Its password is set out of band.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wat2do_ingest_agent') THEN
        CREATE ROLE wat2do_ingest_agent NOLOGIN;
    END IF;
END
$$;
ALTER ROLE wat2do_ingest_agent SET statement_timeout = '30s';

GRANT USAGE ON SCHEMA public TO wat2do_ingest_agent;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.events, public.event_dates, public.positions
    TO wat2do_ingest_agent;
GRANT SELECT ON public.clubs, public.schools TO wat2do_ingest_agent;
GRANT USAGE, SELECT ON SEQUENCE public.events_id_seq, public.positions_id_seq TO wat2do_ingest_agent;
-- The co-host check locks referenced clubs, which needs more than SELECT.
-- It only reads clubs, so it runs as its owner for every writer.
ALTER FUNCTION public.validate_club_cohosts() SECURITY DEFINER;

DROP POLICY IF EXISTS ingest_agent_write ON public.events;
CREATE POLICY ingest_agent_write ON public.events FOR ALL TO wat2do_ingest_agent
    USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS ingest_agent_write ON public.event_dates;
CREATE POLICY ingest_agent_write ON public.event_dates FOR ALL TO wat2do_ingest_agent
    USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS ingest_agent_write ON public.positions;
CREATE POLICY ingest_agent_write ON public.positions FOR ALL TO wat2do_ingest_agent
    USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS ingest_agent_read ON public.clubs;
CREATE POLICY ingest_agent_read ON public.clubs FOR SELECT TO wat2do_ingest_agent USING (true);
DROP POLICY IF EXISTS ingest_agent_read ON public.schools;
CREATE POLICY ingest_agent_read ON public.schools FOR SELECT TO wat2do_ingest_agent USING (true);

-- Rows the agent touched while processing one queued item. The processor
-- drains this after every item: it refreshes the affected feeds and alerts
-- people going to an event whose dates, location, or cancellation changed.
CREATE TABLE IF NOT EXISTS public.ingestion_changes (
    kind text NOT NULL CHECK (kind IN ('event', 'position')),
    record_id bigint NOT NULL,
    school_id integer,
    -- The event before the agent's first change; NULL for rows it created.
    snapshot jsonb,
    PRIMARY KEY (kind, record_id)
);
ALTER TABLE public.ingestion_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ingestion_changes FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ingestion_changes TO service_role;

CREATE OR REPLACE FUNCTION public.ingestion_event_snapshot(p_event_id integer)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
    SELECT jsonb_build_object(
        'location', event.location,
        'cancelled', event.cancelled,
        'occurrences', COALESCE((
            SELECT jsonb_agg(
                jsonb_build_object(
                    'id', event_date.id,
                    'event_id', event_date.event_id,
                    'dtstart_utc', event_date.dtstart_utc,
                    'dtend_utc', event_date.dtend_utc,
                    'duration', event_date.duration,
                    'tz', event_date.tz
                )
                ORDER BY event_date.dtstart_utc
            )
            FROM public.event_dates AS event_date
            WHERE event_date.event_id = event.id
        ), '[]'::jsonb),
        -- Captured before deleting a date can cascade away its attendees.
        'going_user_ids', COALESCE((
            SELECT jsonb_agg(DISTINCT going.user_id)
            FROM public.user_going_events AS going
            WHERE going.event_id = event.id
        ), '[]'::jsonb)
    )
    FROM public.events AS event
    WHERE event.id = p_event_id;
$$;
REVOKE ALL ON FUNCTION public.ingestion_event_snapshot(integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.capture_ingestion_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_event_id integer;
BEGIN
    IF session_user <> 'wat2do_ingest_agent' THEN
        RETURN COALESCE(NEW, OLD);
    END IF;
    IF TG_TABLE_NAME = 'positions' THEN
        INSERT INTO public.ingestion_changes (kind, record_id, school_id)
        VALUES ('position', COALESCE(NEW.id, OLD.id), COALESCE(NEW.school_id, OLD.school_id))
        ON CONFLICT DO NOTHING;
    ELSIF TG_TABLE_NAME = 'events' THEN
        INSERT INTO public.ingestion_changes (kind, record_id, school_id, snapshot)
        VALUES (
            'event',
            COALESCE(NEW.id, OLD.id),
            COALESCE(NEW.school_id, OLD.school_id),
            CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE public.ingestion_event_snapshot(OLD.id) END
        )
        ON CONFLICT DO NOTHING;
    ELSE
        v_event_id := COALESCE(NEW.event_id, OLD.event_id);
        INSERT INTO public.ingestion_changes (kind, record_id, school_id, snapshot)
        SELECT 'event', event.id, event.school_id, public.ingestion_event_snapshot(event.id)
        FROM public.events AS event
        WHERE event.id = v_event_id
        ON CONFLICT DO NOTHING;
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;
REVOKE ALL ON FUNCTION public.capture_ingestion_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS capture_ingestion_change ON public.events;
CREATE TRIGGER capture_ingestion_change BEFORE INSERT OR UPDATE OR DELETE ON public.events
    FOR EACH ROW EXECUTE FUNCTION public.capture_ingestion_change();
DROP TRIGGER IF EXISTS capture_ingestion_change ON public.event_dates;
CREATE TRIGGER capture_ingestion_change BEFORE INSERT OR UPDATE OR DELETE ON public.event_dates
    FOR EACH ROW EXECUTE FUNCTION public.capture_ingestion_change();
DROP TRIGGER IF EXISTS capture_ingestion_change ON public.positions;
CREATE TRIGGER capture_ingestion_change BEFORE INSERT OR UPDATE OR DELETE ON public.positions
    FOR EACH ROW EXECUTE FUNCTION public.capture_ingestion_change();

COMMIT;
