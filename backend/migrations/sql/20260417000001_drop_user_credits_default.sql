-- Migration: drop DEFAULT from user_credits.balance
-- Created: 2026-04-17
--
-- Fixes audit finding D8: user_credits.balance has a hard-coded
-- `DEFAULT 100` at the DB layer.  The Python application controls the
-- initial grant via core.constants.DEFAULT_CREDIT_BALANCE (also 100)
-- and the ensure_user_credits RPC always passes p_default_balance
-- explicitly — so the DB default is redundant and will drift if the
-- application constant changes.
--
-- Any out-of-band INSERT that omits the balance (e.g. a manual SQL
-- edit or a future RLS-aware path) would silently use the DB's 100
-- instead of the application default.  Drop the default so callers
-- must supply the value explicitly — the application constant becomes
-- the single source of truth.
--
-- Impact: ensure_user_credits() and adjust_credits() both set balance
-- explicitly when inserting, so this migration is a no-op for the
-- existing code paths.  Any NEW code path that tries to INSERT without
-- balance will get a NOT NULL violation (fail-fast, not silent drift).
--
-- Idempotent via pg_attribute inspection.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        WHERE c.relname = 'user_credits'
          AND a.attname = 'balance'
          AND a.atthasdef
    ) THEN
        ALTER TABLE user_credits ALTER COLUMN balance DROP DEFAULT;
    END IF;
END $$;
