-- Add approved-template attribution, atomic promoter batches, placement capture,
-- richer owned earnings, and privacy-preserving campus coverage.

BEGIN;

ALTER TABLE public.qr_codes
    ADD COLUMN IF NOT EXISTS poster_template_id character varying(100);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_qr_codes_poster_template_id'
          AND conrelid = 'public.qr_codes'::regclass
    ) THEN
        ALTER TABLE public.qr_codes
            ADD CONSTRAINT chk_qr_codes_poster_template_id
            CHECK (
                poster_template_id IS NULL
                OR poster_template_id ~ '^[a-z0-9][a-z0-9-]*$'
            );
    END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS ix_qr_codes_promoter_school_location
    ON public.qr_codes (
        (filters ->> 'school'),
        latitude,
        longitude,
        latest_scan
    )
    WHERE program = 'promoter' AND is_active = true;

CREATE OR REPLACE FUNCTION public.record_qr_scan(
    p_scan_id uuid,
    p_qr_code_id character varying,
    p_dedupe_hash text,
    p_ip_hash text,
    p_browser_family character varying,
    p_os_family character varying,
    p_asn bigint,
    p_country character varying,
    p_latitude double precision,
    p_longitude double precision
)
RETURNS SETOF public.qr_code_scans
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_qr_code public.qr_codes%ROWTYPE;
BEGIN
    SELECT *
    INTO v_qr_code
    FROM public.qr_codes
    WHERE id = p_qr_code_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'qr_code_not_found';
    END IF;

    IF NOT v_qr_code.is_active THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'qr_code_archived';
    END IF;

    IF v_qr_code.program = 'standard' AND v_qr_code.latest_scan IS NULL THEN
        IF p_latitude IS NULL OR p_longitude IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'requires_location';
        END IF;
        UPDATE public.qr_codes
        SET latitude = p_latitude, longitude = p_longitude
        WHERE id = p_qr_code_id;
    ELSIF v_qr_code.program = 'promoter'
       AND v_qr_code.latitude = 0
       AND v_qr_code.longitude = 0
       AND p_latitude IS NOT NULL
       AND p_longitude IS NOT NULL
       AND NOT (p_latitude = 0 AND p_longitude = 0)
    THEN
        UPDATE public.qr_codes
        SET latitude = p_latitude, longitude = p_longitude
        WHERE id = p_qr_code_id;
    END IF;

    RETURN QUERY
    INSERT INTO public.qr_code_scans (
        id,
        qr_code_id,
        dedupe_hash,
        ip_hash,
        browser_family,
        os_family,
        asn,
        country
    )
    VALUES (
        p_scan_id,
        p_qr_code_id,
        p_dedupe_hash,
        p_ip_hash,
        p_browser_family,
        p_os_family,
        p_asn,
        p_country
    )
    RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.record_qr_scan(
    uuid,
    character varying,
    text,
    text,
    character varying,
    character varying,
    bigint,
    character varying,
    double precision,
    double precision
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_qr_scan(
    uuid,
    character varying,
    text,
    text,
    character varying,
    character varying,
    bigint,
    character varying,
    double precision,
    double precision
) TO service_role;

DROP FUNCTION IF EXISTS public.create_promoter_qr_code(
    character varying,
    character varying,
    text,
    jsonb,
    uuid,
    character varying,
    integer
);

CREATE OR REPLACE FUNCTION public.create_promoter_qr_codes(
    p_ids character varying[],
    p_names character varying[],
    p_created_by uuid,
    p_school character varying,
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

    IF v_user.school IS NULL
       OR p_school IS NULL
       OR length(btrim(p_school)) = 0
       OR lower(btrim(v_user.school)) <> p_school
    THEN
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
        poster_template_id
    )
    SELECT
        requested.id,
        requested.name,
        NULL,
        'events-list',
        NULL,
        jsonb_build_object('school', p_school),
        p_created_by,
        true,
        p_image_url,
        0,
        0,
        'promoter',
        p_poster_template_id
    FROM unnest(p_ids, p_names) AS requested(id, name)
    RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.create_promoter_qr_codes(
    character varying[],
    character varying[],
    uuid,
    character varying,
    character varying,
    character varying,
    integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_promoter_qr_codes(
    character varying[],
    character varying[],
    uuid,
    character varying,
    character varying,
    character varying,
    integer
) TO service_role;

DROP FUNCTION IF EXISTS public.get_promoter_earnings(
    uuid,
    timestamp with time zone,
    timestamp with time zone
);

CREATE FUNCTION public.get_promoter_earnings(
    p_user_id uuid,
    p_period_start timestamp with time zone,
    p_period_end timestamp with time zone
)
RETURNS TABLE(
    qr_code_id character varying,
    name character varying,
    is_active boolean,
    latest_scan timestamp with time zone,
    latitude double precision,
    longitude double precision,
    poster_template_id character varying,
    image_url character varying,
    lifetime_unique_scans bigint,
    period_unique_scans bigint,
    period_creditable_scans bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
    WITH first_visits AS (
        SELECT
            scan.qr_code_id,
            scan.dedupe_hash,
            min(scan.scanned_at) AS first_scanned_at
        FROM public.qr_code_scans AS scan
        JOIN public.qr_codes AS qr_code ON qr_code.id = scan.qr_code_id
        WHERE qr_code.created_by = p_user_id
          AND qr_code.program = 'promoter'
          AND scan.landing_confirmed_at IS NOT NULL
          AND scan.scanned_at < p_period_end
        GROUP BY scan.qr_code_id, scan.dedupe_hash
    ),
    poster_totals AS (
        SELECT
            first_visit.qr_code_id,
            count(*) AS lifetime_unique_scans,
            count(*) FILTER (
                WHERE first_visit.first_scanned_at >= p_period_start
                  AND first_visit.first_scanned_at < p_period_end
            ) AS period_unique_scans,
            min(first_visit.first_scanned_at) AS first_poster_scan
        FROM first_visits AS first_visit
        GROUP BY first_visit.qr_code_id
    )
    SELECT
        qr_code.id,
        qr_code.name,
        qr_code.is_active,
        qr_code.latest_scan,
        qr_code.latitude,
        qr_code.longitude,
        qr_code.poster_template_id,
        qr_code.image_url,
        COALESCE(total.lifetime_unique_scans, 0),
        COALESCE(total.period_unique_scans, 0),
        GREATEST(
            COALESCE(total.period_unique_scans, 0)
            - CASE
                WHEN total.first_poster_scan >= p_period_start
                 AND total.first_poster_scan < p_period_end
                THEN 1
                ELSE 0
              END,
            0
        )
    FROM public.qr_codes AS qr_code
    LEFT JOIN poster_totals AS total ON total.qr_code_id = qr_code.id
    WHERE qr_code.created_by = p_user_id
      AND qr_code.program = 'promoter'
    ORDER BY qr_code.created_at DESC, qr_code.id;
$$;

REVOKE ALL ON FUNCTION public.get_promoter_earnings(
    uuid,
    timestamp with time zone,
    timestamp with time zone
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_promoter_earnings(
    uuid,
    timestamp with time zone,
    timestamp with time zone
) TO service_role;

CREATE OR REPLACE FUNCTION public.get_promoter_campus_coverage(
    p_school character varying,
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
          AND qr_code.filters ->> 'school' = p_school
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
    character varying,
    timestamp with time zone,
    integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_promoter_campus_coverage(
    character varying,
    timestamp with time zone,
    integer
) TO service_role;

COMMIT;
