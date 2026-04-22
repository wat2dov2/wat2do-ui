-- Migration: fix promote_event return shape + idempotency predicate
-- Created: 2026-04-16
-- Depends on: 20260416003_unique_active_promotions.sql,
--             20260408070000_idempotent_promote_event.sql
--
-- Fixes
--   C2: promote_event RETURNED only (promotion_id, new_balance, start_date,
--       end_date, created_at) — missing user_id, event_id, package,
--       credits_spent.  PromotionResponse.model_validate() raised every
--       call, so the *happy path* returned 500.
--   C4: idempotency predicate matched on (user_id, event_id) only.  A user
--       who first promoted with "featured" and then retried with "combo"
--       silently got the cheap "featured" record back with no charge.
--   C5: the idempotent-return branch also truncated the payload, so
--       legitimate retries 500'd for the same reason as C2.
--   C3: relied on FOR UPDATE against zero rows.  Replaced with
--       INSERT ... ON CONFLICT (user_id, event_id, package) DO NOTHING —
--       the unique index from 20260416003_unique_active_promotions.sql is
--       the real concurrency guard.
--
-- RETURN TABLE now includes every column that PromotionResponse expects.
-- On retry with an *active* existing row for (user_id, event_id, package)
-- the RPC returns the original row unchanged.  A retry with a *different*
-- package for the same event creates a new row and charges for it (no
-- silent cheap-package reuse).

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
    user_id         UUID,
    event_id        INTEGER,
    package         VARCHAR(32),
    credits_spent   INTEGER,
    new_balance     INTEGER,
    start_date      TIMESTAMPTZ,
    end_date        TIMESTAMPTZ,
    created_at      TIMESTAMPTZ
)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_existing        RECORD;
    v_new_balance     INTEGER;
    v_promo_id        UUID;
    v_start           TIMESTAMPTZ;
    v_end             TIMESTAMPTZ;
    v_current_balance INTEGER;
BEGIN
    -- Guard: credits_cost must be non-negative.
    IF p_credits_cost < 0 THEN
        RAISE EXCEPTION 'credits_cost must be non-negative'
            USING ERRCODE = 'P0001';
    END IF;

    -- ── Idempotency: match on (user_id, event_id, package) AND end_date >
    --    now().  An expired row with the same key cannot collide with a new
    --    insert because the unique index is non-partial, so we first delete
    --    any expired conflict row; only then does the caller get charged.
    DELETE FROM event_promotions ep
    WHERE ep.user_id = p_user_id
      AND ep.event_id = p_event_id
      AND ep.package = p_package
      AND ep.end_date <= now();

    SELECT ep.id, ep.user_id, ep.event_id, ep.package, ep.credits_spent,
           ep.start_date, ep.end_date, ep.created_at
    INTO v_existing
    FROM event_promotions ep
    WHERE ep.user_id  = p_user_id
      AND ep.event_id = p_event_id
      AND ep.package  = p_package
      AND ep.end_date > now()
    LIMIT 1
    FOR UPDATE;

    IF FOUND THEN
        -- Active promotion already exists.  Return it without charging.
        SELECT uc.balance INTO v_current_balance
        FROM user_credits uc
        WHERE uc.user_id = p_user_id;

        IF v_current_balance IS NULL THEN
            v_current_balance := p_default_balance;
        END IF;

        RETURN QUERY
            SELECT v_existing.id,
                   v_existing.user_id,
                   v_existing.event_id,
                   v_existing.package,
                   v_existing.credits_spent,
                   v_current_balance,
                   v_existing.start_date,
                   v_existing.end_date,
                   v_existing.created_at;
        RETURN;
    END IF;

    -- ── No active promotion — proceed with creation ─────────────────
    PERFORM ensure_user_credits(p_user_id, p_default_balance);

    UPDATE user_credits
    SET balance = balance - p_credits_cost,
        updated_at = now()
    WHERE user_credits.user_id = p_user_id
      AND user_credits.balance >= p_credits_cost
    RETURNING balance INTO v_new_balance;

    IF v_new_balance IS NULL THEN
        RAISE EXCEPTION 'insufficient_credits'
            USING ERRCODE = 'P0001';
    END IF;

    v_promo_id := gen_random_uuid();
    v_start    := now();
    v_end      := now() + (p_duration_days || ' days')::INTERVAL;

    -- C3: ON CONFLICT relies on the unique index from
    -- 20260416003_unique_active_promotions.sql.  If a concurrent
    -- transaction beat us to the insert we refund the deduction and
    -- return the winner's row.
    INSERT INTO event_promotions (id, user_id, event_id, package, credits_spent, start_date, end_date)
    VALUES (v_promo_id, p_user_id, p_event_id, p_package, p_credits_cost, v_start, v_end)
    ON CONFLICT (user_id, event_id, package) DO NOTHING
    RETURNING id, start_date, end_date, created_at
    INTO v_existing;

    IF v_existing.id IS NULL THEN
        -- Another transaction won.  Refund the credits we just deducted
        -- and return the winner's row.
        UPDATE user_credits
        SET balance = balance + p_credits_cost,
            updated_at = now()
        WHERE user_credits.user_id = p_user_id;

        SELECT ep.id, ep.user_id, ep.event_id, ep.package, ep.credits_spent,
               ep.start_date, ep.end_date, ep.created_at
        INTO v_existing
        FROM event_promotions ep
        WHERE ep.user_id  = p_user_id
          AND ep.event_id = p_event_id
          AND ep.package  = p_package
          AND ep.end_date > now()
        LIMIT 1;

        SELECT uc.balance INTO v_current_balance
        FROM user_credits uc
        WHERE uc.user_id = p_user_id;

        IF v_current_balance IS NULL THEN
            v_current_balance := p_default_balance;
        END IF;

        RETURN QUERY
            SELECT v_existing.id,
                   v_existing.user_id,
                   v_existing.event_id,
                   v_existing.package,
                   v_existing.credits_spent,
                   v_current_balance,
                   v_existing.start_date,
                   v_existing.end_date,
                   v_existing.created_at;
        RETURN;
    END IF;

    RETURN QUERY
        SELECT v_promo_id,
               p_user_id,
               p_event_id,
               p_package,
               p_credits_cost,
               v_new_balance,
               v_start,
               v_end,
               v_start;  -- created_at = start_date for new rows
END;
$$;
