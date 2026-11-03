-- Events keep two locations: ``location`` is the venue exactly as the host
-- wrote it, and ``map_location`` is a geocodable rewrite of it that places
-- the event on the map. NULL means the event has no physical place.
BEGIN;

ALTER TABLE public.events
    ADD COLUMN IF NOT EXISTS map_location character varying(500);

-- Existing locations were already expanded for the map, so they seed the map
-- column until backfill_event_map_locations.py rewrites each one.
UPDATE public.events SET map_location = location WHERE map_location IS NULL;

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

COMMIT;
