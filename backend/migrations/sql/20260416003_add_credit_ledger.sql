-- Migration: add credit_transactions ledger
-- Created: 2026-04-16
-- Depends on: 20260406_001_add_credits_and_promotions.sql,
--             20260407020000_add_atomic_credit_functions.sql,
--             20260416003_fix_promote_event_return_shape.sql
--
-- Problem (C7): every balance mutation (adjust_credits, promote_event)
-- directly UPDATEs user_credits.balance with no audit row.  There is no
-- way to answer "who added credits, when, why" or to reconcile
-- sum(deltas) vs current balance.  Disputes and fraud investigations have
-- literally no trail.
--
-- Fix: add a credit_transactions table and have both RPC functions insert
-- a matching row in the same transaction.  Each row records:
--   * user_id          — whose balance changed
--   * delta            — signed amount (+N for grant, -N for spend)
--   * balance_after    — the resulting balance (denormalised for reconciliation)
--   * kind             — "adjust" | "promote" | "refund" (extensible)
--   * reason_id        — optional FK-like reference to e.g. a promotion row
--   * metadata         — JSONB for any extra context (payment id, actor, etc.)
--   * created_at       — timestamp
--
-- RLS is enabled; service_role bypasses, so the application (which uses
-- the service-role key) can read/write freely while direct PostgREST
-- access from anon/authenticated keys is blocked.

CREATE TABLE IF NOT EXISTS credit_transactions (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID NOT NULL,
    delta          INTEGER NOT NULL,
    balance_after  INTEGER NOT NULL,
    kind           VARCHAR(32) NOT NULL,
    reason_id      UUID,
    metadata       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_credit_txn_kind
        CHECK (kind IN ('adjust', 'promote', 'refund'))
);

CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_id
    ON credit_transactions (user_id, created_at DESC);

-- RLS: every public table must enable row-level security (see CLAUDE.md).
ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;

-- ── Rewrite adjust_credits to emit a ledger row ─────────────────────
-- Signature preserved so callers do not change.  Returns the new balance
-- (or -1 sentinel on insufficient funds, matching the existing contract).
CREATE OR REPLACE FUNCTION adjust_credits(
    p_user_id         UUID,
    p_amount          INTEGER,
    p_default_balance INTEGER DEFAULT 100
)
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_new_balance INTEGER;
BEGIN
    PERFORM ensure_user_credits(p_user_id, p_default_balance);

    IF p_amount >= 0 THEN
        UPDATE user_credits
        SET balance = balance + p_amount,
            updated_at = now()
        WHERE user_credits.user_id = p_user_id
        RETURNING balance INTO v_new_balance;
    ELSE
        UPDATE user_credits
        SET balance = balance + p_amount,
            updated_at = now()
        WHERE user_credits.user_id = p_user_id
          AND user_credits.balance >= -p_amount
        RETURNING balance INTO v_new_balance;

        IF v_new_balance IS NULL THEN
            RETURN -1;
        END IF;
    END IF;

    INSERT INTO credit_transactions (user_id, delta, balance_after, kind)
    VALUES (p_user_id, p_amount, v_new_balance, 'adjust');

    RETURN v_new_balance;
END;
$$;

-- ── Rewrite promote_event to emit a ledger row ──────────────────────
-- Same body as 20260416003_fix_promote_event_return_shape.sql plus an
-- INSERT into credit_transactions whenever credits are actually deducted
-- (or refunded due to ON CONFLICT).  Idempotent-return branch does not
-- emit a ledger row because no balance change occurred.
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
    IF p_credits_cost < 0 THEN
        RAISE EXCEPTION 'credits_cost must be non-negative'
            USING ERRCODE = 'P0001';
    END IF;

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

    INSERT INTO event_promotions (id, user_id, event_id, package, credits_spent, start_date, end_date)
    VALUES (v_promo_id, p_user_id, p_event_id, p_package, p_credits_cost, v_start, v_end)
    ON CONFLICT (user_id, event_id, package) DO NOTHING
    RETURNING id, start_date, end_date, created_at
    INTO v_existing;

    IF v_existing.id IS NULL THEN
        -- Lost the race: refund and return the winner's row.
        UPDATE user_credits
        SET balance = balance + p_credits_cost,
            updated_at = now()
        WHERE user_credits.user_id = p_user_id
        RETURNING balance INTO v_new_balance;

        INSERT INTO credit_transactions (user_id, delta, balance_after, kind, reason_id, metadata)
        VALUES (
            p_user_id,
            p_credits_cost,
            COALESCE(v_new_balance, 0),
            'refund',
            NULL,
            jsonb_build_object('event_id', p_event_id, 'package', p_package, 'cause', 'conflict')
        );

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

    INSERT INTO credit_transactions (user_id, delta, balance_after, kind, reason_id, metadata)
    VALUES (
        p_user_id,
        -p_credits_cost,
        v_new_balance,
        'promote',
        v_promo_id,
        jsonb_build_object('event_id', p_event_id, 'package', p_package)
    );

    RETURN QUERY
        SELECT v_promo_id,
               p_user_id,
               p_event_id,
               p_package,
               p_credits_cost,
               v_new_balance,
               v_start,
               v_end,
               v_start;
END;
$$;
