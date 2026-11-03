-- Replace the affiliation boolean with one normalized organization type string.
--
-- Organizations own the value. Event API responses read it through the existing
-- events.organization_id foreign-key embed, so events do not duplicate it.

BEGIN;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS organization_type text;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'organizations'
      AND column_name = 'association_affiliated'
  ) THEN
    UPDATE public.organizations
       SET organization_type = CASE
         WHEN association_affiliated THEN
           CASE lower(trim(coalesce(school, '')))
             WHEN 'uwaterloo' THEN 'wusa'
             WHEN 'utoronto' THEN 'utsu'
             WHEN 'utsc' THEN 'scsu'
             WHEN 'utm' THEN 'utmsu'
             WHEN 'mcgill' THEN 'ssmu'
             WHEN 'mcmaster' THEN 'msu'
             WHEN 'western' THEN 'usc'
             WHEN 'queens' THEN 'ams'
             WHEN 'carleton' THEN 'cusa'
             WHEN 'brock' THEN 'busu'
             WHEN 'wlu' THEN 'wlusu'
             WHEN 'york' THEN 'yfs'
             WHEN 'tmu' THEN 'tmsu'
             WHEN 'uottawa' THEN 'uosu'
             WHEN 'ocad' THEN 'ocadsu'
             WHEN 'cornell' THEN 'sa'
             WHEN 'nyu' THEN 'sga'
             WHEN 'upenn' THEN 'ua'
             WHEN 'columbia' THEN 'ccsc'
             WHEN 'mit' THEN 'ua'
             WHEN 'ubc' THEN 'ams'
             WHEN 'berkeley' THEN 'asuc'
             ELSE 'independent'
           END
         ELSE 'independent'
       END
     WHERE organization_type IS NULL;
  ELSE
    UPDATE public.organizations
       SET organization_type = 'independent'
     WHERE organization_type IS NULL;
  END IF;
END
$$;

ALTER TABLE public.organizations
  ALTER COLUMN organization_type SET DEFAULT 'independent',
  ALTER COLUMN organization_type SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'organizations_organization_type_slug_check'
      AND conrelid = 'public.organizations'::regclass
  ) THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_organization_type_slug_check
      CHECK (
        char_length(organization_type) BETWEEN 1 AND 100
        AND organization_type = lower(trim(organization_type))
        AND organization_type ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
      );
  END IF;
END
$$;

DROP INDEX IF EXISTS public.idx_events_association_affiliated;

ALTER TABLE public.events
  DROP COLUMN IF EXISTS association_affiliated,
  DROP COLUMN IF EXISTS organization_type;

ALTER TABLE public.organizations
  DROP COLUMN IF EXISTS association_affiliated;

-- Keep event updates aligned with the normalized schema. Organization type is
-- read from organizations at query time and is never accepted in an event patch.
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
        organization_id = CASE
            WHEN p_event_patch ? 'organization_id'
                THEN (p_event_patch->>'organization_id')::integer
            ELSE event.organization_id
        END,
        organization = CASE
            WHEN p_event_patch ? 'organization' THEN p_event_patch->>'organization'
            ELSE event.organization
        END,
        school = CASE
            WHEN p_event_patch ? 'school' THEN p_event_patch->>'school'
            ELSE event.school
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
    FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_event_with_occurrences(integer, jsonb, jsonb)
    FROM anon;
REVOKE ALL ON FUNCTION public.update_event_with_occurrences(integer, jsonb, jsonb)
    FROM authenticated;
GRANT EXECUTE ON FUNCTION public.update_event_with_occurrences(integer, jsonb, jsonb)
    TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
