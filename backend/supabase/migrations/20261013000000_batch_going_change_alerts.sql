BEGIN;

-- People going to an event get one email per burst of edits instead of one per
-- edit. The first material change from any writer records the event as it was;
-- later changes only move changed_at. Once an event has been quiet for the
-- backend's window, the backend compares the record with the event as it is now
-- and sends a single alert.
CREATE TABLE IF NOT EXISTS public.event_change_alerts (
    event_id integer PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
    -- The event before the first change: location, cancelled, occurrences and
    -- who was going.
    snapshot jsonb NOT NULL,
    changed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.event_change_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_change_alerts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.event_change_alerts TO service_role;

-- The snapshot now serves every writer, not only the ingestion agent.
ALTER FUNCTION public.ingestion_event_snapshot(integer) RENAME TO going_event_snapshot;

CREATE OR REPLACE FUNCTION public.capture_event_change_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_event_id integer;
BEGIN
    IF TG_TABLE_NAME = 'events' THEN
        IF (OLD.location, OLD.cancelled) IS NOT DISTINCT FROM (NEW.location, NEW.cancelled) THEN
            RETURN NEW;
        END IF;
        v_event_id := OLD.id;
    ELSE
        IF TG_OP = 'UPDATE'
           AND (OLD.dtstart_utc, OLD.dtend_utc, OLD.duration, OLD.tz)
               IS NOT DISTINCT FROM (NEW.dtstart_utc, NEW.dtend_utc, NEW.duration, NEW.tz)
        THEN
            RETURN NEW;
        END IF;
        v_event_id := COALESCE(NEW.event_id, OLD.event_id);
    END IF;

    -- Reading events skips dates cascading away with a deleted event.
    INSERT INTO public.event_change_alerts (event_id, snapshot)
    SELECT event.id, public.going_event_snapshot(event.id)
    FROM public.events AS event
    WHERE event.id = v_event_id
      AND EXISTS (
          SELECT 1 FROM public.user_going_events AS going WHERE going.event_id = event.id
      )
    ON CONFLICT (event_id) DO UPDATE SET changed_at = now();
    RETURN COALESCE(NEW, OLD);
END;
$$;
REVOKE ALL ON FUNCTION public.capture_event_change_alert() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS capture_event_change_alert ON public.events;
CREATE TRIGGER capture_event_change_alert BEFORE UPDATE ON public.events
    FOR EACH ROW EXECUTE FUNCTION public.capture_event_change_alert();
DROP TRIGGER IF EXISTS capture_event_change_alert ON public.event_dates;
CREATE TRIGGER capture_event_change_alert BEFORE INSERT OR UPDATE OR DELETE ON public.event_dates
    FOR EACH ROW EXECUTE FUNCTION public.capture_event_change_alert();

-- Going alerts no longer ride on the ingestion agent's change log.
ALTER TABLE public.ingestion_changes DROP COLUMN IF EXISTS snapshot;

CREATE OR REPLACE FUNCTION public.capture_ingestion_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF session_user <> 'wat2do_ingest_agent' THEN
        RETURN COALESCE(NEW, OLD);
    END IF;
    IF TG_TABLE_NAME = 'positions' THEN
        INSERT INTO public.ingestion_changes (kind, record_id, school_id)
        VALUES ('position', COALESCE(NEW.id, OLD.id), COALESCE(NEW.school_id, OLD.school_id))
        ON CONFLICT DO NOTHING;
    ELSIF TG_TABLE_NAME = 'events' THEN
        INSERT INTO public.ingestion_changes (kind, record_id, school_id)
        VALUES ('event', COALESCE(NEW.id, OLD.id), COALESCE(NEW.school_id, OLD.school_id))
        ON CONFLICT DO NOTHING;
    ELSE
        INSERT INTO public.ingestion_changes (kind, record_id, school_id)
        SELECT 'event', event.id, event.school_id
        FROM public.events AS event
        WHERE event.id = COALESCE(NEW.event_id, OLD.event_id)
        ON CONFLICT DO NOTHING;
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;

-- The update RPC no longer hands back who was going; the trigger records it.
DROP FUNCTION IF EXISTS public.update_event_with_occurrences(integer, jsonb, jsonb);
CREATE FUNCTION public.update_event_with_occurrences(
    p_event_id integer,
    p_event_patch jsonb,
    p_occurrences jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_occurrence jsonb;
    v_occurrence_id uuid;
    v_retained_ids uuid[] := ARRAY[]::uuid[];
BEGIN
    PERFORM 1
    FROM public.events AS event
    WHERE event.id = p_event_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'event_not_found';
    END IF;

    UPDATE public.events AS event
    SET
        cohost_club_ids = CASE
            WHEN p_event_patch ? 'cohost_club_ids' THEN
                ARRAY(SELECT jsonb_array_elements_text(p_event_patch->'cohost_club_ids')::integer)
            ELSE event.cohost_club_ids
        END,
        competition = CASE WHEN p_event_patch ? 'competition' THEN (p_event_patch->>'competition')::boolean ELSE event.competition END,
        featured = CASE WHEN p_event_patch ? 'featured' THEN COALESCE((p_event_patch->>'featured')::boolean, false) ELSE event.featured END,
        title = CASE
            WHEN p_event_patch ? 'title' THEN p_event_patch->>'title'
            ELSE event.title
        END,
        description = CASE
            WHEN p_event_patch ? 'description' THEN p_event_patch->>'description'
            ELSE event.description
        END,
        location = CASE
            WHEN p_event_patch ? 'location' THEN p_event_patch->>'location'
            ELSE event.location
        END,
        map_location = CASE
            WHEN p_event_patch ? 'map_location' THEN p_event_patch->>'map_location'
            ELSE event.map_location
        END,
        price = CASE
            WHEN p_event_patch ? 'price' THEN (p_event_patch->>'price')::double precision
            ELSE event.price
        END,
        food = CASE
            WHEN p_event_patch ? 'food'
                THEN NULLIF(p_event_patch->'food', 'null'::jsonb)
            ELSE event.food
        END,
        employers_on_campus = CASE
            WHEN p_event_patch ? 'employers_on_campus' THEN (p_event_patch->>'employers_on_campus')::boolean
            ELSE event.employers_on_campus
        END,
        free_food_on_campus = CASE
            WHEN p_event_patch ? 'free_food_on_campus' THEN (p_event_patch->>'free_food_on_campus')::boolean
            ELSE event.free_food_on_campus
        END,
        sports_game = CASE
            WHEN p_event_patch ? 'sports_game' THEN (p_event_patch->>'sports_game')::boolean
            ELSE event.sports_game
        END,
        campus_season_ids = CASE
            WHEN NOT (p_event_patch ? 'campus_season_ids') THEN event.campus_season_ids
            WHEN p_event_patch->'campus_season_ids' = 'null'::jsonb THEN NULL
            ELSE ARRAY(SELECT jsonb_array_elements_text(p_event_patch->'campus_season_ids'))
        END,
        registration = CASE
            WHEN p_event_patch ? 'registration' THEN (p_event_patch->>'registration')::boolean
            ELSE event.registration
        END,
        source_image_url = CASE
            WHEN p_event_patch ? 'source_image_url' THEN p_event_patch->>'source_image_url'
            ELSE event.source_image_url
        END,
        source_url = CASE
            WHEN p_event_patch ? 'source_url' THEN p_event_patch->>'source_url'
            ELSE event.source_url
        END,
        category = CASE
            WHEN p_event_patch ? 'category' THEN p_event_patch->>'category'
            ELSE event.category
        END,
        club_id = CASE
            WHEN p_event_patch ? 'club_id'
                THEN (p_event_patch->>'club_id')::integer
            ELSE event.club_id
        END,
        club = CASE
            WHEN p_event_patch ? 'club' THEN p_event_patch->>'club'
            ELSE event.club
        END,
        school_id = CASE
            WHEN p_event_patch ? 'school_id'
                THEN (p_event_patch->>'school_id')::integer
            ELSE event.school_id
        END,
        ig_handle = CASE
            WHEN p_event_patch ? 'ig_handle' THEN p_event_patch->>'ig_handle'
            ELSE event.ig_handle
        END,
        cancelled = CASE
            WHEN p_event_patch ? 'cancelled' THEN (p_event_patch->>'cancelled')::boolean
            ELSE event.cancelled
        END
    WHERE event.id = p_event_id;

    IF p_occurrences IS NOT NULL THEN
        IF jsonb_typeof(p_occurrences) <> 'array'
           OR jsonb_array_length(p_occurrences) = 0
        THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_occurrences';
        END IF;

        IF (
            SELECT count(*)
            FROM jsonb_array_elements(p_occurrences) AS supplied(value)
            WHERE supplied.value ? 'id'
              AND supplied.value->>'id' IS NOT NULL
        ) <> (
            SELECT count(DISTINCT supplied.value->>'id')
            FROM jsonb_array_elements(p_occurrences) AS supplied(value)
            WHERE supplied.value ? 'id'
              AND supplied.value->>'id' IS NOT NULL
        ) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'duplicate_occurrence_id';
        END IF;

        FOR v_occurrence IN
            SELECT supplied.value
            FROM jsonb_array_elements(p_occurrences) AS supplied(value)
        LOOP
            v_occurrence_id := NULLIF(v_occurrence->>'id', '')::uuid;

            IF v_occurrence_id IS NULL THEN
                INSERT INTO public.event_dates (
                    event_id,
                    dtstart_utc,
                    dtend_utc,
                    duration,
                    tz
                )
                VALUES (
                    p_event_id,
                    (v_occurrence->>'dtstart_utc')::timestamptz,
                    (v_occurrence->>'dtend_utc')::timestamptz,
                    v_occurrence->>'duration',
                    v_occurrence->>'tz'
                )
                RETURNING id INTO v_occurrence_id;
            ELSE
                UPDATE public.event_dates AS event_date
                SET
                    dtstart_utc = (v_occurrence->>'dtstart_utc')::timestamptz,
                    dtend_utc = (v_occurrence->>'dtend_utc')::timestamptz,
                    duration = v_occurrence->>'duration',
                    tz = v_occurrence->>'tz'
                WHERE event_date.id = v_occurrence_id
                  AND event_date.event_id = p_event_id;

                IF NOT FOUND THEN
                    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_occurrence_id';
                END IF;
            END IF;

            v_retained_ids := array_append(v_retained_ids, v_occurrence_id);
        END LOOP;

        DELETE FROM public.event_dates AS event_date
        WHERE event_date.event_id = p_event_id
          AND NOT (event_date.id = ANY(v_retained_ids));
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.update_event_with_occurrences(integer, jsonb, jsonb)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_event_with_occurrences(integer, jsonb, jsonb)
    TO service_role;
-- Every minute with pending alerts, ask the backend to send the quiet ones. The
-- backend URL and its bearer key live in Vault as event_change_alerts_url and
-- event_change_alerts_key; without them the job does nothing.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.schedule(
    'send_event_change_alerts',
    '* * * * *',
    $$
    SELECT net.http_post(
        url := secret.url,
        headers := jsonb_build_object('Authorization', 'Bearer ' || secret.key)
    )
    FROM (
        SELECT
            (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'event_change_alerts_url') AS url,
            (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'event_change_alerts_key') AS key
    ) AS secret
    WHERE secret.url IS NOT NULL
      AND secret.key IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.event_change_alerts);
    $$
);

COMMIT;
