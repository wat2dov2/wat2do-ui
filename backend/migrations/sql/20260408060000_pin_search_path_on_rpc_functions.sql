-- Migration: pin search_path on all RPC functions
-- Created: 2026-04-08
--
-- Security fix for CVE-2018-1058 (schema shadowing).
--
-- Without an explicit SET search_path, a plpgsql/sql function resolves
-- unqualified table and function names using the *caller's* search_path
-- at execution time.  If any role can create objects in a schema that
-- appears before "public" in the search_path, it can shadow the tables
-- these functions reference (user_credits, event_promotions,
-- ab_test_events) and intercept or modify data.
--
-- Even in Supabase's managed environment, CIS PostgreSQL Benchmark 4.6
-- (and 4.2 in earlier editions) requires functions to pin their
-- search_path.  This is defence-in-depth: if a future configuration
-- change or extension adds schemas to the search_path, these functions
-- remain safe.
--
-- This migration uses CREATE OR REPLACE FUNCTION with the identical
-- signature and body as the originals, adding only
-- SET search_path = public.

-- ── ensure_user_credits ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION ensure_user_credits(p_user_id UUID, p_default_balance INTEGER DEFAULT 100)
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_balance INTEGER;
BEGIN
    SELECT balance INTO v_balance
    FROM user_credits
    WHERE user_id = p_user_id;

    IF NOT FOUND THEN
        INSERT INTO user_credits (user_id, balance)
        VALUES (p_user_id, p_default_balance)
        ON CONFLICT (user_id) DO NOTHING
        RETURNING balance INTO v_balance;

        -- If the INSERT hit a conflict (concurrent insert), read the existing row.
        IF v_balance IS NULL THEN
            SELECT balance INTO v_balance
            FROM user_credits
            WHERE user_id = p_user_id;
        END IF;
    END IF;

    RETURN v_balance;
END;
$$;

-- ── adjust_credits ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION adjust_credits(p_user_id UUID, p_amount INTEGER, p_default_balance INTEGER DEFAULT 100)
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_new_balance INTEGER;
BEGIN
    -- Ensure the row exists first.
    PERFORM ensure_user_credits(p_user_id, p_default_balance);

    IF p_amount >= 0 THEN
        -- Addition: always succeeds.
        UPDATE user_credits
        SET balance = balance + p_amount,
            updated_at = now()
        WHERE user_id = p_user_id
        RETURNING balance INTO v_new_balance;
    ELSE
        -- Deduction: atomic check-and-subtract.
        -- Only updates if balance >= |p_amount|, preventing negative balances.
        UPDATE user_credits
        SET balance = balance + p_amount,
            updated_at = now()
        WHERE user_id = p_user_id
          AND balance >= abs(p_amount)
        RETURNING balance INTO v_new_balance;

        -- If no row was updated, the user has insufficient credits.
        IF v_new_balance IS NULL THEN
            RETURN -1;
        END IF;
    END IF;

    RETURN v_new_balance;
END;
$$;

-- ── promote_event ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION promote_event(
    p_user_id       UUID,
    p_event_id      INTEGER,
    p_package        VARCHAR(32),
    p_credits_cost   INTEGER,
    p_duration_days  INTEGER,
    p_default_balance INTEGER DEFAULT 100
)
RETURNS TABLE (
    promotion_id    UUID,
    new_balance     INTEGER,
    start_date      TIMESTAMPTZ,
    end_date        TIMESTAMPTZ
)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_new_balance   INTEGER;
    v_promo_id      UUID;
    v_start         TIMESTAMPTZ;
    v_end           TIMESTAMPTZ;
BEGIN
    -- Guard: credits_cost must be non-negative.
    IF p_credits_cost < 0 THEN
        RAISE EXCEPTION 'credits_cost must be non-negative'
            USING ERRCODE = 'P0001';
    END IF;

    -- Ensure the credits row exists.
    PERFORM ensure_user_credits(p_user_id, p_default_balance);

    -- Atomic deduction: only succeeds if balance is sufficient.
    UPDATE user_credits
    SET balance = balance - p_credits_cost,
        updated_at = now()
    WHERE user_id = p_user_id
      AND balance >= p_credits_cost
    RETURNING balance INTO v_new_balance;

    IF v_new_balance IS NULL THEN
        RAISE EXCEPTION 'insufficient_credits'
            USING ERRCODE = 'P0001';
    END IF;

    -- Insert the promotion in the same transaction.
    v_promo_id := gen_random_uuid();
    v_start    := now();
    v_end      := now() + (p_duration_days || ' days')::INTERVAL;

    INSERT INTO event_promotions (id, user_id, event_id, package, credits_spent, start_date, end_date)
    VALUES (v_promo_id, p_user_id, p_event_id, p_package, p_credits_cost, v_start, v_end);

    RETURN QUERY SELECT v_promo_id, v_new_balance, v_start, v_end;
END;
$$;

-- ── get_ab_test_ctr ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_ab_test_ctr(p_experiment_name VARCHAR)
RETURNS TABLE (
    variant     VARCHAR,
    impressions BIGINT,
    clicks      BIGINT
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
    SELECT
        a.variant,
        COUNT(*) FILTER (WHERE a.event_type = 'impression') AS impressions,
        COUNT(*) FILTER (WHERE a.event_type = 'click')      AS clicks
    FROM ab_test_events a
    WHERE a.experiment_name = p_experiment_name
    GROUP BY a.variant
    ORDER BY a.variant;
$$;
