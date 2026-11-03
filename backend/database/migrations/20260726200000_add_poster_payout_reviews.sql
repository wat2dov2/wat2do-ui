BEGIN;

CREATE TABLE IF NOT EXISTS public.poster_payout_reviews (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    payout_id uuid NOT NULL
        REFERENCES public.poster_payouts(id) ON DELETE RESTRICT,
    from_status character varying(16) NOT NULL,
    to_status character varying(16) NOT NULL,
    notes text,
    reviewed_by uuid NOT NULL
        REFERENCES public.users(id) ON DELETE RESTRICT,
    reviewed_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT chk_poster_payout_reviews_transition
        CHECK (
            (from_status = 'pending' AND to_status IN ('held', 'paid'))
            OR
            (from_status = 'held' AND to_status IN ('pending', 'voided'))
        ),
    CONSTRAINT chk_poster_payout_reviews_notes
        CHECK (
            (
                to_status NOT IN ('held', 'voided')
                OR length(btrim(COALESCE(notes, ''))) > 0
            )
            AND length(COALESCE(notes, '')) <= 10000
        )
);

ALTER TABLE public.poster_payout_reviews ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS ix_poster_payout_reviews_payout_time
    ON public.poster_payout_reviews (payout_id, reviewed_at, id);

CREATE OR REPLACE FUNCTION public.prevent_poster_payout_review_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'poster_payout_reviews_append_only';
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS prevent_poster_payout_review_mutation
    ON public.poster_payout_reviews;
CREATE TRIGGER prevent_poster_payout_review_mutation
BEFORE UPDATE OR DELETE ON public.poster_payout_reviews
FOR EACH ROW
EXECUTE FUNCTION public.prevent_poster_payout_review_mutation();

CREATE OR REPLACE FUNCTION public.transition_poster_payout_status(
    p_payout_id uuid,
    p_target_status character varying,
    p_notes text,
    p_reviewed_by uuid
)
RETURNS SETOF public.poster_payouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_current public.poster_payouts%ROWTYPE;
    v_updated public.poster_payouts%ROWTYPE;
    v_notes text := NULLIF(btrim(p_notes), '');
    v_reviewed_at timestamp with time zone;
BEGIN
    PERFORM 1
    FROM public.users
    WHERE id = p_reviewed_by
      AND role = 'admin'
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P0001',
            MESSAGE = 'admin_access_required';
    END IF;

    SELECT *
    INTO v_current
    FROM public.poster_payouts
    WHERE id = p_payout_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P0001',
            MESSAGE = 'payout_not_found';
    END IF;

    IF p_target_status IS NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P0001',
            MESSAGE = 'invalid_payout_status_transition';
    END IF;

    IF NOT (
        (v_current.status = 'pending' AND p_target_status IN ('held', 'paid'))
        OR
        (v_current.status = 'held' AND p_target_status IN ('pending', 'voided'))
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P0001',
            MESSAGE = 'invalid_payout_status_transition';
    END IF;

    IF p_target_status IN ('held', 'voided') AND v_notes IS NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P0001',
            MESSAGE = 'payout_notes_required';
    END IF;

    v_reviewed_at := clock_timestamp();

    UPDATE public.poster_payouts
    SET
        status = p_target_status,
        paid_at = CASE
            WHEN p_target_status = 'paid' THEN v_reviewed_at
            ELSE NULL
        END,
        notes = CASE
            WHEN p_target_status IN ('held', 'voided') THEN v_notes
            ELSE NULL
        END,
        reviewed_by = p_reviewed_by
    WHERE id = p_payout_id
    RETURNING * INTO v_updated;

    INSERT INTO public.poster_payout_reviews (
        payout_id,
        from_status,
        to_status,
        notes,
        reviewed_by,
        reviewed_at
    )
    VALUES (
        p_payout_id,
        v_current.status,
        p_target_status,
        v_notes,
        p_reviewed_by,
        v_reviewed_at
    );

    RETURN NEXT v_updated;
END;
$$;

DROP FUNCTION IF EXISTS public.mark_poster_payouts_paid(
    uuid[],
    uuid,
    timestamp with time zone
);

CREATE FUNCTION public.mark_poster_payouts_paid(
    p_ids uuid[],
    p_reviewed_by uuid
)
RETURNS SETOF public.poster_payouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_requested_count integer;
    v_found_count integer := 0;
    v_locked_status character varying(16);
    v_updated_count integer;
    v_paid_at timestamp with time zone;
BEGIN
    SELECT count(DISTINCT supplied.id)
    INTO v_requested_count
    FROM unnest(COALESCE(p_ids, ARRAY[]::uuid[])) AS supplied(id)
    WHERE supplied.id IS NOT NULL;

    IF v_requested_count = 0 THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P0001',
            MESSAGE = 'payout_ids_required';
    END IF;

    PERFORM 1
    FROM public.users
    WHERE id = p_reviewed_by
      AND role = 'admin'
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P0001',
            MESSAGE = 'admin_access_required';
    END IF;

    FOR v_locked_status IN
        SELECT payout.status
        FROM public.poster_payouts AS payout
        WHERE payout.id = ANY(p_ids)
        ORDER BY payout.id
        FOR UPDATE
    LOOP
        v_found_count := v_found_count + 1;
        IF v_locked_status <> 'pending' THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P0001',
                MESSAGE = 'invalid_payout_status_transition';
        END IF;
    END LOOP;

    IF v_found_count <> v_requested_count THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P0001',
            MESSAGE = 'invalid_payout_status_transition';
    END IF;

    v_paid_at := clock_timestamp();

    RETURN QUERY
    WITH updated_payouts AS (
        UPDATE public.poster_payouts AS payout
        SET
            status = 'paid',
            paid_at = v_paid_at,
            notes = NULL,
            reviewed_by = p_reviewed_by
        WHERE payout.id = ANY(p_ids)
          AND payout.status = 'pending'
        RETURNING payout.*
    ),
    inserted_reviews AS (
        INSERT INTO public.poster_payout_reviews (
            payout_id,
            from_status,
            to_status,
            notes,
            reviewed_by,
            reviewed_at
        )
        SELECT
            payout.id,
            'pending',
            'paid',
            NULL,
            p_reviewed_by,
            v_paid_at
        FROM updated_payouts AS payout
        RETURNING payout_id
    )
    SELECT payout.*
    FROM updated_payouts AS payout
    JOIN inserted_reviews AS review ON review.payout_id = payout.id
    ORDER BY payout.id;

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    IF v_updated_count <> v_requested_count THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P0001',
            MESSAGE = 'invalid_payout_status_transition';
    END IF;
END;
$$;

REVOKE ALL ON TABLE public.poster_payout_reviews
    FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.poster_payout_reviews TO service_role;

REVOKE ALL ON FUNCTION public.prevent_poster_payout_review_mutation()
    FROM PUBLIC;

REVOKE ALL ON FUNCTION public.transition_poster_payout_status(
    uuid,
    character varying,
    text,
    uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transition_poster_payout_status(
    uuid,
    character varying,
    text,
    uuid
) TO service_role;

REVOKE ALL ON FUNCTION public.mark_poster_payouts_paid(
    uuid[],
    uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_poster_payouts_paid(
    uuid[],
    uuid
) TO service_role;

COMMIT;
