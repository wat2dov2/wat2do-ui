-- Migration: add atomic credit functions
-- Created: 2026-04-07
--
-- Fixes TOCTOU race condition in add_credits / deduct_credits.
-- Both functions perform the balance check and update in a single
-- atomic SQL statement, preventing double-spending from concurrent requests.

-- ensure_user_credits: get-or-create a user_credits row, return balance.
CREATE OR REPLACE FUNCTION ensure_user_credits(p_user_id UUID, p_default_balance INTEGER DEFAULT 100)
RETURNS INTEGER
LANGUAGE plpgsql
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

-- adjust_credits: atomically add or deduct credits.
-- p_amount can be positive (add) or negative (deduct).
-- Returns the new balance, or -1 if insufficient funds for a deduction.
-- The UPDATE ... WHERE balance >= abs(amount) ensures atomicity for deductions.
CREATE OR REPLACE FUNCTION adjust_credits(p_user_id UUID, p_amount INTEGER, p_default_balance INTEGER DEFAULT 100)
RETURNS INTEGER
LANGUAGE plpgsql
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
