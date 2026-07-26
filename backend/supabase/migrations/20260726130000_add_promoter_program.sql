-- Add the promoter poster program, privacy-preserving scan signals, and payouts.
--
-- Existing QR scan history is intentionally discarded. The old session_id,
-- user_agent, conversion_actions, and user_id fields do not meet the promoter
-- program's privacy or deduplication requirements, and this feature has no
-- legacy scan compatibility requirement.

BEGIN;

DELETE FROM public.qr_code_scans;

DROP INDEX IF EXISTS public.ix_qr_code_scans_qr_code_id;

ALTER TABLE public.qr_code_scans
    DROP COLUMN user_id,
    DROP COLUMN session_id,
    DROP COLUMN conversion_actions,
    DROP COLUMN user_agent,
    ADD COLUMN dedupe_hash text NOT NULL,
    ADD COLUMN ip_hash text NOT NULL,
    ADD COLUMN browser_family character varying(64),
    ADD COLUMN os_family character varying(64),
    ADD COLUMN asn bigint,
    ADD COLUMN country character(2),
    ADD COLUMN landing_confirmed_at timestamp with time zone,
    ADD COLUMN risk_score integer NOT NULL DEFAULT 0,
    ADD COLUMN risk_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN risk_evaluated_at timestamp with time zone,
    ADD COLUMN risk_rules_version character varying(64),
    ALTER COLUMN scanned_at SET NOT NULL,
    ALTER COLUMN scanned_at SET DEFAULT now(),
    ADD CONSTRAINT chk_qr_code_scans_country
        CHECK (country IS NULL OR country ~ '^[A-Z]{2}$'),
    ADD CONSTRAINT chk_qr_code_scans_risk_score
        CHECK (risk_score >= 0),
    ADD CONSTRAINT chk_qr_code_scans_risk_flags_array
        CHECK (jsonb_typeof(risk_flags) = 'array');

CREATE INDEX ix_qr_code_scans_qr_code_scanned_at
    ON public.qr_code_scans (qr_code_id, scanned_at DESC);
CREATE INDEX ix_qr_code_scans_qr_code_dedupe
    ON public.qr_code_scans (qr_code_id, dedupe_hash);
CREATE INDEX ix_qr_code_scans_dedupe_scanned_at
    ON public.qr_code_scans (dedupe_hash, scanned_at);
CREATE INDEX ix_qr_code_scans_ip_scanned_at
    ON public.qr_code_scans (ip_hash, scanned_at);
CREATE INDEX ix_qr_code_scans_confirmed_earnings
    ON public.qr_code_scans (qr_code_id, dedupe_hash, scanned_at)
    WHERE landing_confirmed_at IS NOT NULL;

ALTER TABLE public.qr_codes
    ADD COLUMN program character varying(16) NOT NULL DEFAULT 'standard',
    ADD COLUMN latest_scan timestamp with time zone,
    ALTER COLUMN is_active SET DEFAULT true,
    ALTER COLUMN is_active SET NOT NULL,
    ADD CONSTRAINT chk_qr_codes_program
        CHECK (program IN ('standard', 'promoter'));

-- Before this migration false meant "waiting for a first scan", not archived.
-- From this point onward is_active has one meaning only: not archived.
UPDATE public.qr_codes SET is_active = true;

CREATE INDEX ix_qr_codes_owner_program_active
    ON public.qr_codes (created_by, program, is_active);
CREATE INDEX ix_qr_codes_program_latest_scan
    ON public.qr_codes (program, latest_scan DESC);

CREATE OR REPLACE FUNCTION public.update_qr_code_latest_scan()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    UPDATE public.qr_codes
    SET latest_scan = GREATEST(
        COALESCE(latest_scan, '-infinity'::timestamptz),
        NEW.scanned_at
    )
    WHERE id = NEW.qr_code_id;
    RETURN NEW;
END;
$$;

CREATE TRIGGER set_qr_code_latest_scan
AFTER INSERT ON public.qr_code_scans
FOR EACH ROW
EXECUTE FUNCTION public.update_qr_code_latest_scan();

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

ALTER TABLE public.users
    ADD COLUMN payout_email character varying(320),
    ADD COLUMN promoter_tos_accepted_at timestamp with time zone,
    ADD COLUMN promoter_tos_version character varying(64),
    ADD CONSTRAINT chk_users_promoter_enrollment_complete
        CHECK (
            (
                payout_email IS NULL
                AND promoter_tos_accepted_at IS NULL
                AND promoter_tos_version IS NULL
            )
            OR
            (
                payout_email IS NOT NULL
                AND promoter_tos_accepted_at IS NOT NULL
                AND promoter_tos_version IS NOT NULL
            )
        );

CREATE TABLE public.poster_payouts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL
        REFERENCES public.users(id) ON DELETE RESTRICT,
    period date NOT NULL,
    payout_email character varying(320) NOT NULL,
    rate_cents integer NOT NULL,
    amount_cents integer NOT NULL,
    scan_count integer NOT NULL,
    status character varying(16) NOT NULL DEFAULT 'pending',
    paid_at timestamp with time zone,
    notes text,
    reviewed_by uuid
        REFERENCES public.users(id) ON DELETE SET NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT poster_payouts_user_period_key UNIQUE (user_id, period),
    CONSTRAINT chk_poster_payouts_period_start
        CHECK (period = date_trunc('month', period::timestamp)::date),
    CONSTRAINT chk_poster_payouts_rate
        CHECK (rate_cents > 0),
    CONSTRAINT chk_poster_payouts_counts
        CHECK (amount_cents >= 0 AND scan_count >= 0),
    CONSTRAINT chk_poster_payouts_amount
        CHECK (amount_cents = rate_cents * scan_count),
    CONSTRAINT chk_poster_payouts_status
        CHECK (status IN ('pending', 'held', 'paid', 'voided')),
    CONSTRAINT chk_poster_payouts_paid_at
        CHECK (
            (status = 'paid' AND paid_at IS NOT NULL)
            OR
            (status <> 'paid' AND paid_at IS NULL)
        ),
    CONSTRAINT chk_poster_payouts_review_notes
        CHECK (
            status NOT IN ('held', 'voided')
            OR length(btrim(COALESCE(notes, ''))) > 0
        )
);

ALTER TABLE public.poster_payouts ENABLE ROW LEVEL SECURITY;

CREATE INDEX ix_poster_payouts_user_created
    ON public.poster_payouts (user_id, created_at DESC);
CREATE INDEX ix_poster_payouts_period_status
    ON public.poster_payouts (period DESC, status);

CREATE OR REPLACE FUNCTION public.touch_poster_payout_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    NEW.updated_at = clock_timestamp();
    RETURN NEW;
END;
$$;

CREATE TRIGGER set_poster_payout_updated_at
BEFORE UPDATE ON public.poster_payouts
FOR EACH ROW
EXECUTE FUNCTION public.touch_poster_payout_updated_at();

CREATE OR REPLACE FUNCTION public.create_promoter_qr_code(
    p_id character varying,
    p_name character varying,
    p_description text,
    p_filters jsonb,
    p_created_by uuid,
    p_image_url character varying,
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
BEGIN
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

    IF v_user.school IS NULL OR length(btrim(v_user.school)) = 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'promoter_school_required';
    END IF;

    SELECT count(*)
    INTO v_active_count
    FROM public.qr_codes
    WHERE created_by = p_created_by
      AND program = 'promoter'
      AND is_active = true;

    IF v_active_count >= p_maximum_active_posters THEN
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
        program
    )
    VALUES (
        p_id,
        p_name,
        p_description,
        'events-list',
        NULL,
        COALESCE(p_filters, '{}'::jsonb) || jsonb_build_object('school', v_user.school),
        p_created_by,
        true,
        p_image_url,
        0,
        0,
        'promoter'
    )
    RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.create_promoter_qr_code(
    character varying,
    character varying,
    text,
    jsonb,
    uuid,
    character varying,
    integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_promoter_qr_code(
    character varying,
    character varying,
    text,
    jsonb,
    uuid,
    character varying,
    integer
) TO service_role;

CREATE OR REPLACE FUNCTION public.get_promoter_earnings(
    p_user_id uuid,
    p_period_start timestamp with time zone,
    p_period_end timestamp with time zone
)
RETURNS TABLE(
    qr_code_id character varying,
    name character varying,
    is_active boolean,
    latest_scan timestamp with time zone,
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

CREATE OR REPLACE FUNCTION public.mark_poster_payouts_paid(
    p_ids uuid[],
    p_reviewed_by uuid,
    p_paid_at timestamp with time zone
)
RETURNS SETOF public.poster_payouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_requested_count integer;
    v_pending_count integer;
BEGIN
    SELECT count(DISTINCT supplied.id)
    INTO v_requested_count
    FROM unnest(COALESCE(p_ids, ARRAY[]::uuid[])) AS supplied(id)
    WHERE supplied.id IS NOT NULL;

    IF v_requested_count = 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'payout_ids_required';
    END IF;

    PERFORM 1
    FROM public.users
    WHERE id = p_reviewed_by
      AND role = 'admin'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'admin_access_required';
    END IF;

    PERFORM 1
    FROM public.poster_payouts
    WHERE id = ANY(p_ids)
      AND status = 'pending'
    FOR UPDATE;

    SELECT count(*)
    INTO v_pending_count
    FROM public.poster_payouts
    WHERE id = ANY(p_ids)
      AND status = 'pending';

    IF v_pending_count <> v_requested_count THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payout_status_transition';
    END IF;

    RETURN QUERY
    UPDATE public.poster_payouts
    SET
        status = 'paid',
        paid_at = p_paid_at,
        reviewed_by = p_reviewed_by
    WHERE id = ANY(p_ids)
    RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_poster_payouts_paid(
    uuid[],
    uuid,
    timestamp with time zone
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_poster_payouts_paid(
    uuid[],
    uuid,
    timestamp with time zone
) TO service_role;

COMMIT;
