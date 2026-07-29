-- Make public.schools the only table that stores school slugs.
--
-- Domain tables reference schools.id and API consumers derive the public slug
-- through that relationship. Recipient IDs and Instagram credentials are not
-- changed by this migration.

BEGIN;

CREATE TEMPORARY TABLE school_slug_changes (
    old_slug text PRIMARY KEY,
    new_slug text NOT NULL UNIQUE
) ON COMMIT DROP;

INSERT INTO school_slug_changes (old_slug, new_slug)
VALUES
    ('laval', 'ulaval'),
    ('memorial', 'mun'),
    ('ocad', 'ocadu'),
    ('uottawa', 'ottawa'),
    ('utoronto', 'utsg'),
    ('western', 'uwo'),
    ('windsor', 'uwindsor'),
    ('york', 'yorku'),
    ('queens', 'queensu');

UPDATE public.schools AS school
SET slug = change.new_slug
FROM school_slug_changes AS change
WHERE school.slug = change.old_slug;

CREATE TEMPORARY TABLE school_identity_lookup (
    normalized_value text PRIMARY KEY,
    school_id integer NOT NULL
) ON COMMIT DROP;

INSERT INTO school_identity_lookup (normalized_value, school_id)
SELECT lower(btrim(school.slug)), school.id
FROM public.schools AS school;

INSERT INTO school_identity_lookup (normalized_value, school_id)
SELECT lower(btrim(school.name)), school.id
FROM public.schools AS school
ON CONFLICT (normalized_value) DO NOTHING;

INSERT INTO school_identity_lookup (normalized_value, school_id)
SELECT change.old_slug, school.id
FROM school_slug_changes AS change
JOIN public.schools AS school ON school.slug = change.new_slug
ON CONFLICT (normalized_value) DO NOTHING;

ALTER TABLE public.organizations
    ADD COLUMN school_id integer;
ALTER TABLE public.events
    ADD COLUMN school_id integer;
ALTER TABLE public.users
    ADD COLUMN school_id integer;
ALTER TABLE public.instagram_publishing_accounts
    ADD COLUMN school_id integer;
ALTER TABLE public.instagram_publish_batches
    ADD COLUMN school_id integer;
ALTER TABLE public.qr_codes
    ADD COLUMN school_id integer;
ALTER TABLE public.event_submissions
    ADD COLUMN school_id integer;

UPDATE public.organizations AS organization
SET school_id = lookup.school_id
FROM school_identity_lookup AS lookup
WHERE lookup.normalized_value = lower(btrim(organization.school));

UPDATE public.events AS event
SET school_id = lookup.school_id
FROM school_identity_lookup AS lookup
WHERE lookup.normalized_value = lower(btrim(event.school));

UPDATE public.users AS app_user
SET school_id = lookup.school_id
FROM school_identity_lookup AS lookup
WHERE lookup.normalized_value = lower(btrim(app_user.school));

UPDATE public.instagram_publishing_accounts AS account
SET school_id = lookup.school_id
FROM school_identity_lookup AS lookup
WHERE lookup.normalized_value = lower(btrim(account.school));

UPDATE public.instagram_publish_batches AS batch
SET school_id = lookup.school_id
FROM school_identity_lookup AS lookup
WHERE lookup.normalized_value = lower(btrim(batch.school));

UPDATE public.qr_codes AS qr_code
SET school_id = lookup.school_id
FROM school_identity_lookup AS lookup
WHERE lookup.normalized_value = lower(btrim(qr_code.filters ->> 'school'));

UPDATE public.event_submissions AS submission
SET school_id = organization.school_id
FROM public.organizations AS organization
WHERE submission.event_data ->> 'organization_id' ~ '^[0-9]+$'
  AND organization.id = (submission.event_data ->> 'organization_id')::integer;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.organizations WHERE school_id IS NULL) THEN
        RAISE EXCEPTION 'Every organization must resolve to schools.id';
    END IF;
    IF EXISTS (SELECT 1 FROM public.events WHERE school_id IS NULL) THEN
        RAISE EXCEPTION 'Every event must resolve to schools.id';
    END IF;
    IF EXISTS (SELECT 1 FROM public.users WHERE school_id IS NULL) THEN
        RAISE EXCEPTION 'Every user must resolve to schools.id';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM public.instagram_publishing_accounts
        WHERE school_id IS NULL
    ) THEN
        RAISE EXCEPTION 'Every Instagram publishing account must resolve to schools.id';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM public.instagram_publish_batches
        WHERE school_id IS NULL
    ) THEN
        RAISE EXCEPTION 'Every Instagram publishing batch must resolve to schools.id';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM public.qr_codes
        WHERE program = 'promoter'
          AND school_id IS NULL
    ) THEN
        RAISE EXCEPTION 'Every promoter QR code must resolve to schools.id';
    END IF;
    IF EXISTS (SELECT 1 FROM public.event_submissions WHERE school_id IS NULL) THEN
        RAISE EXCEPTION 'Every event submission must resolve to schools.id';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM public.events AS event
        JOIN public.organizations AS organization
          ON organization.id = event.organization_id
        WHERE event.school_id <> organization.school_id
    ) THEN
        RAISE EXCEPTION 'Event and organization school relationships disagree';
    END IF;
END;
$$;

ALTER TABLE public.organizations
    ALTER COLUMN school_id SET NOT NULL,
    ADD CONSTRAINT organizations_school_id_fkey
        FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE RESTRICT;
ALTER TABLE public.events
    ALTER COLUMN school_id SET NOT NULL,
    ADD CONSTRAINT events_school_id_fkey
        FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE RESTRICT;
ALTER TABLE public.users
    ALTER COLUMN school_id SET NOT NULL,
    ADD CONSTRAINT users_school_id_fkey
        FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE RESTRICT;
ALTER TABLE public.instagram_publishing_accounts
    ALTER COLUMN school_id SET NOT NULL,
    ADD CONSTRAINT instagram_publishing_accounts_school_id_fkey
        FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE RESTRICT,
    ADD CONSTRAINT instagram_publishing_accounts_school_id_key UNIQUE (school_id);
ALTER TABLE public.instagram_publish_batches
    ALTER COLUMN school_id SET NOT NULL,
    ADD CONSTRAINT instagram_publish_batches_school_id_fkey
        FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE RESTRICT;
ALTER TABLE public.qr_codes
    ADD CONSTRAINT qr_codes_school_id_fkey
        FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE RESTRICT,
    ADD CONSTRAINT qr_codes_promoter_school_id_check
        CHECK (program <> 'promoter' OR school_id IS NOT NULL);
ALTER TABLE public.event_submissions
    ALTER COLUMN school_id SET NOT NULL,
    ADD CONSTRAINT event_submissions_school_id_fkey
        FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION public.enforce_event_organization_school()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_organization_school_id integer;
BEGIN
    IF NEW.organization_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT organization.school_id
    INTO v_organization_school_id
    FROM public.organizations AS organization
    WHERE organization.id = NEW.organization_id;

    IF v_organization_school_id IS NULL
       OR NEW.school_id <> v_organization_school_id
    THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'event school must match its organization school';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_event_organization_school
BEFORE INSERT OR UPDATE OF organization_id, school_id ON public.events
FOR EACH ROW
EXECUTE FUNCTION public.enforce_event_organization_school();

DROP FUNCTION IF EXISTS public.create_promoter_qr_codes(
    character varying[],
    character varying[],
    uuid,
    character varying,
    character varying,
    character varying,
    integer
);

CREATE FUNCTION public.create_promoter_qr_codes(
    p_ids character varying[],
    p_names character varying[],
    p_created_by uuid,
    p_school_id integer,
    p_image_url character varying,
    p_poster_template_id character varying,
    p_maximum_active_posters integer
)
RETURNS SETOF public.qr_codes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user public.users%ROWTYPE;
    v_active_count integer;
    v_requested_count integer;
BEGIN
    v_requested_count := COALESCE(cardinality(p_ids), 0);
    IF v_requested_count = 0
       OR cardinality(p_names) <> v_requested_count
       OR p_poster_template_id IS NULL
       OR length(btrim(p_poster_template_id)) = 0
       OR EXISTS (
            SELECT 1
            FROM unnest(p_ids, p_names) AS requested(id, name)
            WHERE requested.id IS NULL
               OR length(btrim(requested.id)) = 0
               OR requested.name IS NULL
               OR length(btrim(requested.name)) = 0
       )
    THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_promoter_batch';
    END IF;

    SELECT *
    INTO v_user
    FROM public.users
    WHERE id = p_created_by
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'user_not_found';
    END IF;

    IF v_user.payout_email IS NULL
       OR v_user.promoter_tos_accepted_at IS NULL
       OR v_user.promoter_tos_version IS NULL
    THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'promoter_enrollment_required';
    END IF;

    IF p_school_id IS NULL OR v_user.school_id <> p_school_id THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'promoter_school_required';
    END IF;

    SELECT count(*)
    INTO v_active_count
    FROM public.qr_codes
    WHERE created_by = p_created_by
      AND program = 'promoter'
      AND is_active = true;

    IF v_active_count + v_requested_count > p_maximum_active_posters THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'promoter_poster_limit_reached';
    END IF;

    RETURN QUERY
    INSERT INTO public.qr_codes (
        id,
        name,
        description,
        destination_type,
        destination_id,
        filters,
        created_by,
        is_active,
        image_url,
        latitude,
        longitude,
        program,
        poster_template_id,
        school_id
    )
    SELECT
        requested.id,
        requested.name,
        NULL,
        'events-list',
        NULL,
        '{}'::jsonb,
        p_created_by,
        true,
        p_image_url,
        0,
        0,
        'promoter',
        p_poster_template_id,
        p_school_id
    FROM unnest(p_ids, p_names) AS requested(id, name)
    RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.create_promoter_qr_codes(
    character varying[],
    character varying[],
    uuid,
    integer,
    character varying,
    character varying,
    integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_promoter_qr_codes(
    character varying[],
    character varying[],
    uuid,
    integer,
    character varying,
    character varying,
    integer
) TO service_role;

DROP FUNCTION IF EXISTS public.get_promoter_campus_coverage(
    character varying,
    timestamp with time zone,
    integer
);

CREATE FUNCTION public.get_promoter_campus_coverage(
    p_school_id integer,
    p_quiet_cutoff timestamp with time zone,
    p_coordinate_decimal_places integer
)
RETURNS TABLE(
    latitude double precision,
    longitude double precision,
    poster_count bigint,
    recent_poster_count bigint,
    quiet_poster_count bigint,
    confirmed_unique_visitors bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
    WITH placed_posters AS (
        SELECT
            qr_code.id,
            round(
                qr_code.latitude::numeric,
                p_coordinate_decimal_places
            )::double precision AS cell_latitude,
            round(
                qr_code.longitude::numeric,
                p_coordinate_decimal_places
            )::double precision AS cell_longitude,
            qr_code.latest_scan
        FROM public.qr_codes AS qr_code
        WHERE qr_code.program = 'promoter'
          AND qr_code.is_active = true
          AND qr_code.school_id = p_school_id
          AND NOT (qr_code.latitude = 0 AND qr_code.longitude = 0)
    ),
    cell_visitor_totals AS (
        SELECT
            poster.cell_latitude,
            poster.cell_longitude,
            count(DISTINCT scan.dedupe_hash) AS confirmed_unique_visitors
        FROM public.qr_code_scans AS scan
        JOIN placed_posters AS poster ON poster.id = scan.qr_code_id
        WHERE scan.landing_confirmed_at IS NOT NULL
        GROUP BY poster.cell_latitude, poster.cell_longitude
    )
    SELECT
        poster.cell_latitude,
        poster.cell_longitude,
        count(*),
        count(*) FILTER (WHERE poster.latest_scan >= p_quiet_cutoff),
        count(*) FILTER (
            WHERE poster.latest_scan IS NULL
               OR poster.latest_scan < p_quiet_cutoff
        ),
        COALESCE(visitor.confirmed_unique_visitors, 0)
    FROM placed_posters AS poster
    LEFT JOIN cell_visitor_totals AS visitor
      ON visitor.cell_latitude = poster.cell_latitude
     AND visitor.cell_longitude = poster.cell_longitude
    GROUP BY
        poster.cell_latitude,
        poster.cell_longitude,
        visitor.confirmed_unique_visitors
    ORDER BY poster.cell_latitude, poster.cell_longitude;
$$;

REVOKE ALL ON FUNCTION public.get_promoter_campus_coverage(
    integer,
    timestamp with time zone,
    integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_promoter_campus_coverage(
    integer,
    timestamp with time zone,
    integer
) TO service_role;

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

UPDATE public.qr_codes
SET filters = COALESCE(filters, '{}'::jsonb) - 'school';

DROP INDEX IF EXISTS public.ix_qr_codes_promoter_school_location;
DROP INDEX IF EXISTS public.ix_organizations_school_name;
DROP INDEX IF EXISTS public.idx_events_school;
DROP INDEX IF EXISTS public.ix_events_school_id;
DROP INDEX IF EXISTS public.ix_events_school_added_at_desc;

ALTER TABLE public.organizations DROP COLUMN school;
ALTER TABLE public.events DROP COLUMN school;
ALTER TABLE public.users DROP COLUMN school;
ALTER TABLE public.instagram_publishing_accounts DROP COLUMN school;
ALTER TABLE public.instagram_publish_batches DROP COLUMN school;

CREATE INDEX ix_organizations_school_name
    ON public.organizations (school_id, organization_name);
CREATE INDEX ix_events_school_id
    ON public.events (school_id, id);
CREATE INDEX ix_events_school_added_at_desc
    ON public.events (school_id, added_at DESC);
CREATE INDEX ix_users_school_id
    ON public.users (school_id, id);
CREATE INDEX ix_instagram_publish_batches_school_id
    ON public.instagram_publish_batches (school_id, local_date DESC);
CREATE INDEX ix_qr_codes_promoter_school_location
    ON public.qr_codes (school_id, latitude, longitude, latest_scan)
    WHERE program = 'promoter' AND is_active = true;
CREATE INDEX ix_event_submissions_school_id
    ON public.event_submissions (school_id, submitted_at DESC);

CREATE TEMPORARY TABLE instagram_account_key_changes (
    old_key text PRIMARY KEY,
    new_key text NOT NULL UNIQUE
) ON COMMIT DROP;

INSERT INTO instagram_account_key_changes (old_key, new_key)
VALUES
    ('wat2do', 'uwaterloo'),
    ('laval', 'ulaval'),
    ('memorial', 'mun'),
    ('ocad', 'ocadu'),
    ('uottawa', 'ottawa'),
    ('utoronto', 'utsg'),
    ('western', 'uwo'),
    ('windsor', 'uwindsor'),
    ('york', 'yorku'),
    ('queens', 'queensu');

UPDATE public.instagram_publishing_accounts AS account
SET
    account_key = change.new_key,
    updated_at = now()
FROM instagram_account_key_changes AS change
WHERE account.account_key = change.old_key;

UPDATE public.instagram_publish_batches AS batch
SET account_key = change.new_key
FROM instagram_account_key_changes AS change
WHERE batch.account_key = change.old_key;

UPDATE public.instagram_publish_items AS item
SET account_key = change.new_key
FROM instagram_account_key_changes AS change
WHERE item.account_key = change.old_key;

NOTIFY pgrst, 'reload schema';

COMMIT;
