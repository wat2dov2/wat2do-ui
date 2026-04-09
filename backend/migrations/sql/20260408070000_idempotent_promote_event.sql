-- Migration: make promote_event idempotent
-- Created: 2026-04-08
-- Depends on: 20260408060000_pin_search_path_on_rpc_functions
--
-- Problem: promote_event generates a new UUID each call and unconditionally
-- inserts a row + deducts credits.  If a network timeout causes a client
-- retry, credits are deducted twice and a duplicate promotion row is
-- inserted.  There is also no constraint preventing duplicate active
-- promotions for the same (user_id, event_id).
--
-- Fix:
--   1. The RPC now checks for an existing active promotion (end_date > now())
--      for the same (user_id, event_id) BEFORE deducting credits.  If one
--      exists, it returns the existing promotion data — making retries free.
--   2. A UNIQUE index on (user_id, event_id, package) WHERE end_date > now()
--      is NOT possible (now() is not immutable), so we add a plain index to
--      speed up the active-promotion lookup and rely on the RPC-level guard.
--   3. The RETURN TABLE now includes created_at so the Python layer can map
--      it correctly instead of mis-aliasing start_date as created_at.
--
-- Re-promotion after expiry is allowed: once end_date <= now(), the guard
-- no longer matches and a fresh promotion can be created.

-- ── Index to speed up active-promotion lookup ───────────────────────
-- A partial index with `WHERE end_date > now()` is not viable because
-- PostgreSQL evaluates now() at CREATE INDEX time (immutable requirement).
-- A plain composite index on (user_id, event_id) covers the RPC's
-- SELECT ... WHERE user_id = $1 AND event_id = $2 AND end_date > now().
CREATE INDEX IF NOT EXISTS idx_event_promotions_user_event
    ON event_promotions (user_id, event_id);

-- ── Idempotent promote_event ────────────────────────────────────────
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
    end_date        TIMESTAMPTZ,
    created_at      TIMESTAMPTZ
)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_existing       RECORD;
    v_new_balance    INTEGER;
    v_promo_id       UUID;
    v_start          TIMESTAMPTZ;
    v_end            TIMESTAMPTZ;
    v_current_balance INTEGER;
BEGIN
    -- Guard: credits_cost must be non-negative.
    IF p_credits_cost < 0 THEN
        RAISE EXCEPTION 'credits_cost must be non-negative'
            USING ERRCODE = 'P0001';
    END IF;

    -- ── Idempotency: return existing active promotion if present ────
    -- Lock the row (FOR UPDATE) to prevent a concurrent call from
    -- slipping past the check before we finish inserting.
    SELECT ep.id, ep.start_date AS sd, ep.end_date AS ed, ep.created_at AS ca
    INTO v_existing
    FROM event_promotions ep
    WHERE ep.user_id  = p_user_id
      AND ep.event_id = p_event_id
      AND ep.end_date > now()
    ORDER BY ep.end_date DESC
    LIMIT 1
    FOR UPDATE;

    IF FOUND THEN
        -- Active promotion already exists.  Return it without charging.
        -- Fetch the current balance so the caller gets a consistent view.
        SELECT uc.balance INTO v_current_balance
        FROM user_credits uc
        WHERE uc.user_id = p_user_id;

        IF v_current_balance IS NULL THEN
            v_current_balance := p_default_balance;
        END IF;

        RETURN QUERY
            SELECT v_existing.id,
                   v_current_balance,
                   v_existing.sd,
                   v_existing.ed,
                   v_existing.ca;
        RETURN;
    END IF;

    -- ── No active promotion — proceed with creation ─────────────────

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

    RETURN QUERY
        SELECT v_promo_id,
               v_new_balance,
               v_start,
               v_end,
               v_start;  -- created_at = start_date for new rows
END;
$$;
