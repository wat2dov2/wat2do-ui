-- Migration: add atomic promote_event function
-- Created: 2026-04-08
--
-- Wraps credit deduction and promotion insertion in a single transaction
-- to prevent credit loss when the promotion insert fails after deduction.
-- Previously these were two separate PostgREST calls, creating a window
-- where credits could be deducted without a corresponding promotion row.

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
