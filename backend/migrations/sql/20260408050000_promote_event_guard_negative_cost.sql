-- Migration: add negative-cost guard to promote_event
-- Created: 2026-04-08
-- Depends on: 20260408010000_add_atomic_promote_event
--
-- Defence-in-depth: reject p_credits_cost < 0 inside the RPC so that a
-- negative value can never be used to *add* credits instead of deducting
-- them.  The Python layer already controls pricing via PROMOTION_PACKAGES
-- and the RPC is only callable by service_role, so this is a belt-and-
-- suspenders guard rather than a critical exploit fix.

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
