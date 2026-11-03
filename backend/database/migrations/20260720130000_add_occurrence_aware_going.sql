-- Make Going selections occurrence-aware and expose one atomic mutation path.

BEGIN;

ALTER TABLE public.user_going_events
    ADD COLUMN event_date_id uuid;

UPDATE public.user_going_events AS going
SET event_date_id = (
    SELECT event_date.id
    FROM public.event_dates AS event_date
    WHERE event_date.event_id = going.event_id
      AND event_date.dtstart_utc >= now()
    ORDER BY event_date.dtstart_utc, event_date.id
    LIMIT 1
);

DELETE FROM public.user_going_events
WHERE event_date_id IS NULL;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.user_going_events
        WHERE event_date_id IS NULL
    ) THEN
        RAISE EXCEPTION 'Occurrence-aware Going backfill left null selections';
    END IF;
END
$$;

ALTER TABLE public.user_going_events
    DROP CONSTRAINT user_going_events_user_id_event_id_key;

DROP INDEX IF EXISTS public.ix_user_going_events_user_id;

ALTER TABLE public.event_dates
    ADD CONSTRAINT event_dates_event_id_id_key UNIQUE (event_id, id);

ALTER TABLE public.user_going_events
    ADD CONSTRAINT user_going_events_event_occurrence_fkey
        FOREIGN KEY (event_id, event_date_id)
        REFERENCES public.event_dates (event_id, id)
        ON DELETE CASCADE,
    ADD CONSTRAINT user_going_events_user_id_event_date_id_key
        UNIQUE (user_id, event_date_id);

ALTER TABLE public.user_going_events
    ALTER COLUMN event_date_id SET NOT NULL;

CREATE INDEX ix_user_going_events_event_date_id
    ON public.user_going_events (event_date_id);
CREATE INDEX ix_user_going_events_event_id_user_id
    ON public.user_going_events (event_id, user_id);
CREATE INDEX ix_user_going_events_user_id_event_id
    ON public.user_going_events (user_id, event_id);

ALTER TABLE public.user_going_events ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.set_user_going_occurrences(
    p_user_id uuid,
    p_event_id integer,
    p_occurrence_ids uuid[]
)
RETURNS TABLE(
    status text,
    event_id integer,
    occurrence_ids uuid[],
    going_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_occurrence_ids uuid[];
    v_now timestamptz := clock_timestamp();
    v_cancelled boolean;
    v_distinct_event_count integer;
BEGIN
    PERFORM 1
    FROM public.users AS app_user
    WHERE app_user.id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'user_not_found';
    END IF;

    SELECT COALESCE(array_agg(normalized.id ORDER BY normalized.first_position), ARRAY[]::uuid[])
    INTO v_occurrence_ids
    FROM (
        SELECT supplied.id, min(supplied.position) AS first_position
        FROM unnest(COALESCE(p_occurrence_ids, ARRAY[]::uuid[]))
            WITH ORDINALITY AS supplied(id, position)
        WHERE supplied.id IS NOT NULL
        GROUP BY supplied.id
    ) AS normalized;

    SELECT event.cancelled
    INTO v_cancelled
    FROM public.events AS event
    WHERE event.id = p_event_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'event_not_found';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM unnest(v_occurrence_ids) AS selected(id)
        LEFT JOIN public.event_dates AS event_date
          ON event_date.id = selected.id
         AND event_date.event_id = p_event_id
        WHERE event_date.id IS NULL
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_event_occurrence';
    END IF;

    IF v_cancelled AND cardinality(v_occurrence_ids) > 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'event_cancelled';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.event_dates AS event_date
        WHERE event_date.id = ANY(v_occurrence_ids)
          AND event_date.dtstart_utc < v_now
          AND NOT EXISTS (
              SELECT 1
              FROM public.user_going_events AS existing
              WHERE existing.user_id = p_user_id
                AND existing.event_date_id = event_date.id
          )
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'occurrence_not_selectable';
    END IF;

    IF cardinality(v_occurrence_ids) > 0
       AND NOT EXISTS (
           SELECT 1
           FROM public.user_going_events AS existing
           WHERE existing.user_id = p_user_id
             AND existing.event_id = p_event_id
       )
    THEN
        SELECT count(DISTINCT existing.event_id)
        INTO v_distinct_event_count
        FROM public.user_going_events AS existing
        WHERE existing.user_id = p_user_id;

        IF v_distinct_event_count >= 10000 THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'going_events_cap_reached';
        END IF;
    END IF;

    DELETE FROM public.user_going_events AS existing
    WHERE existing.user_id = p_user_id
      AND existing.event_id = p_event_id;

    INSERT INTO public.user_going_events (
        id,
        user_id,
        event_id,
        event_date_id
    )
    SELECT
        gen_random_uuid(),
        p_user_id,
        p_event_id,
        selected.id
    FROM unnest(v_occurrence_ids) AS selected(id);

    RETURN QUERY
    SELECT
        CASE
            WHEN cardinality(v_occurrence_ids) > 0 THEN 'going'
            ELSE 'not_going'
        END,
        p_event_id,
        v_occurrence_ids,
        (
            SELECT count(DISTINCT existing.user_id)
            FROM public.user_going_events AS existing
            WHERE existing.event_id = p_event_id
        );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_event_going_counts(p_event_ids integer[])
RETURNS TABLE(event_id integer, going_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT going.event_id, count(DISTINCT going.user_id)::bigint
    FROM public.user_going_events AS going
    WHERE going.event_id = ANY(p_event_ids)
    GROUP BY going.event_id;
$$;

REVOKE ALL ON FUNCTION public.set_user_going_occurrences(uuid, integer, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_user_going_occurrences(uuid, integer, uuid[]) FROM anon;
REVOKE ALL ON FUNCTION public.set_user_going_occurrences(uuid, integer, uuid[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.set_user_going_occurrences(uuid, integer, uuid[]) TO service_role;

REVOKE ALL ON FUNCTION public.get_event_going_counts(integer[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_event_going_counts(integer[]) FROM anon;
REVOKE ALL ON FUNCTION public.get_event_going_counts(integer[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_event_going_counts(integer[]) TO service_role;

COMMIT;
