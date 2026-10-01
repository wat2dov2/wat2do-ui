BEGIN;

ALTER TABLE public.events ADD COLUMN IF NOT EXISTS cohost_club_ids integer[] NOT NULL DEFAULT '{}';
ALTER TABLE public.positions ADD COLUMN IF NOT EXISTS cohost_club_ids integer[] NOT NULL DEFAULT '{}';
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS competition boolean;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS featured boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS events_cohost_club_ids_idx ON public.events USING gin(cohost_club_ids);
CREATE INDEX IF NOT EXISTS positions_cohost_club_ids_idx ON public.positions USING gin(cohost_club_ids);

-- Keep primary ownership distinct and enforce foreign-key-like integrity for cohosts.
CREATE OR REPLACE FUNCTION public.validate_club_cohosts()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
    NEW.cohost_club_ids := ARRAY(
        SELECT DISTINCT club_id FROM unnest(NEW.cohost_club_ids) AS club_id
        WHERE club_id IS DISTINCT FROM NEW.club_id ORDER BY club_id
    );
    -- Lock referenced clubs against concurrent deletion until this write commits.
    PERFORM club.id FROM public.clubs AS club
        WHERE club.id = ANY(NEW.cohost_club_ids) FOR KEY SHARE;
    IF EXISTS (
        SELECT 1 FROM unnest(NEW.cohost_club_ids) AS cohost(id)
        LEFT JOIN public.clubs AS club ON club.id = cohost.id
        WHERE club.id IS NULL OR club.school_id IS DISTINCT FROM NEW.school_id
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'cohosts must be existing clubs at the same school';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS validate_event_cohosts ON public.events;
CREATE TRIGGER validate_event_cohosts BEFORE INSERT OR UPDATE OF cohost_club_ids, club_id, school_id
    ON public.events FOR EACH ROW EXECUTE FUNCTION public.validate_club_cohosts();
DROP TRIGGER IF EXISTS validate_position_cohosts ON public.positions;
CREATE TRIGGER validate_position_cohosts BEFORE INSERT OR UPDATE OF cohost_club_ids, club_id, school_id
    ON public.positions FOR EACH ROW EXECUTE FUNCTION public.validate_club_cohosts();

CREATE OR REPLACE FUNCTION public.remove_club_cohosts()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
    UPDATE public.events SET cohost_club_ids = array_remove(cohost_club_ids, OLD.id)
        WHERE cohost_club_ids @> ARRAY[OLD.id];
    UPDATE public.positions SET cohost_club_ids = array_remove(cohost_club_ids, OLD.id)
        WHERE cohost_club_ids @> ARRAY[OLD.id];
    RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS remove_club_cohosts ON public.clubs;
CREATE TRIGGER remove_club_cohosts BEFORE DELETE ON public.clubs
    FOR EACH ROW EXECUTE FUNCTION public.remove_club_cohosts();

CREATE OR REPLACE FUNCTION public.validate_cohost_school_change()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
    IF NEW.school_id IS DISTINCT FROM OLD.school_id AND (
        EXISTS(SELECT 1 FROM public.events WHERE cohost_club_ids @> ARRAY[OLD.id]) OR
        EXISTS(SELECT 1 FROM public.positions WHERE cohost_club_ids @> ARRAY[OLD.id])
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'club is a cohost at its current school';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS validate_cohost_school_change ON public.clubs;
CREATE TRIGGER validate_cohost_school_change BEFORE UPDATE OF school_id ON public.clubs
    FOR EACH ROW EXECUTE FUNCTION public.validate_cohost_school_change();

-- PostgREST computed relationships hydrate additional clubs without per-card requests.
CREATE OR REPLACE FUNCTION public.event_cohosts(public.events)
RETURNS SETOF public.clubs LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
    SELECT club.* FROM public.clubs AS club WHERE club.id = ANY(($1).cohost_club_ids) ORDER BY club.id;
$$;
CREATE OR REPLACE FUNCTION public.position_cohosts(public.positions)
RETURNS SETOF public.clubs LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
    SELECT club.* FROM public.clubs AS club WHERE club.id = ANY(($1).cohost_club_ids) ORDER BY club.id;
$$;
CREATE OR REPLACE FUNCTION public.club_names(public.events)
RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
    SELECT concat_ws(' ', ($1).club, (SELECT string_agg(club_name, ' ') FROM public.clubs WHERE id = ANY(($1).cohost_club_ids)));
$$;
CREATE OR REPLACE FUNCTION public.event_count(public.clubs)
RETURNS bigint LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
    SELECT count(*) FROM public.events WHERE club_id = ($1).id OR cohost_club_ids @> ARRAY[($1).id];
$$;

CREATE OR REPLACE FUNCTION public.update_event_with_occurrences(
    p_event_id integer,
    p_event_patch jsonb,
    p_occurrences jsonb DEFAULT NULL
)
RETURNS TABLE(
    occurrences jsonb,
    recipient_ids uuid[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_occurrence jsonb;
    v_occurrence_id uuid;
    v_retained_ids uuid[] := ARRAY[]::uuid[];
    v_recipient_ids uuid[];
BEGIN
    PERFORM 1
    FROM public.events AS event
    WHERE event.id = p_event_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'event_not_found';
    END IF;

    SELECT COALESCE(
        array_agg(DISTINCT going.user_id),
        ARRAY[]::uuid[]
    )
    INTO v_recipient_ids
    FROM public.user_going_events AS going
    WHERE going.event_id = p_event_id;

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

    RETURN QUERY
    SELECT
        COALESCE(
            (
                SELECT jsonb_agg(to_jsonb(event_date) ORDER BY event_date.dtstart_utc)
                FROM public.event_dates AS event_date
                WHERE event_date.event_id = p_event_id
            ),
            '[]'::jsonb
        ),
        v_recipient_ids;
END;
$$;

REVOKE ALL ON FUNCTION public.update_event_with_occurrences(integer, jsonb, jsonb)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_event_with_occurrences(integer, jsonb, jsonb)
    TO service_role;


-- WAT-340's verified coauthored post links only existing school clubs.
UPDATE public.events AS event SET cohost_club_ids = ARRAY[cohost.id]
FROM public.clubs AS cohost
WHERE event.source_url = 'https://www.instagram.com/p/Ddy4xsTNfDe/'
  AND lower(cohost.ig) = 'uwcccf' AND cohost.school_id = event.school_id
  AND cohost.id IS DISTINCT FROM event.club_id;

NOTIFY pgrst, 'reload schema';
COMMIT;
