-- Migration: add missing foreign keys and CHECK constraints
-- Created: 2026-04-09
-- Depends on: all prior migrations (specifically 20260406_000, 20260406_001,
--             20260408030000, 20260408070000)
--
-- Problem: several tables store user_id and event_id columns without
-- corresponding FOREIGN KEY constraints, allowing orphaned rows if a user
-- or event is deleted.  Additionally, no CHECK constraints guard against
-- negative balances or credits_spent, or invalid date ranges.
--
-- Tables affected:
--   user_credits         — missing FK to users, missing CHECK on balance
--   event_promotions     — missing FK to users and events, missing CHECKs
--   user_recommendations — missing FK to users
--   ab_test_events       — missing FK to users
--
-- Design decisions:
--   * FKs reference public.users(id), NOT auth.users(id).  The application
--     stores public.users.id in all user_id columns (via resolve_db_user →
--     db_user.id).  auth.users.id is a different UUID stored in
--     public.users.supabase_auth_id.
--   * ON DELETE CASCADE for user_credits, event_promotions, and
--     user_recommendations: these rows are meaningless without the parent
--     user/event and are either ephemeral (recs recomputed nightly) or
--     tightly coupled to the user lifecycle.
--   * ON DELETE SET NULL for ab_test_events.user_id: aggregate CTR metrics
--     must survive user deletion.  The column is already NOT NULL, so we
--     first relax it to nullable.
--   * ON DELETE CASCADE for event_promotions.event_id → events(id): a
--     promotion for a deleted event serves no purpose.
--   * CHECK (balance >= 0): belt-and-suspenders alongside the RPC-level
--     guard in adjust_credits.  Prevents bugs in future code paths from
--     corrupting balances.
--   * CHECK (credits_spent >= 0): prevents negative-cost promotions at the
--     data layer (complements the RPC guard in promote_event).
--   * CHECK (end_date > start_date): ensures promotions have a valid
--     duration.  The promote_event RPC computes end_date = now() +
--     duration_days, so this should always hold for new rows.
--
-- Safety:
--   * Orphaned rows are deleted BEFORE adding FK constraints so that
--     ADD CONSTRAINT does not fail on existing data.
--   * Each ALTER TABLE uses DO $$ blocks with pg_constraint checks to be
--     safely re-runnable (idempotent).
--   * All changes are DDL and run in an implicit transaction.

-- =========================================================================
-- 0. Helper: check whether a constraint already exists
-- =========================================================================
-- Used by the DO $$ blocks below to make each ALTER idempotent.

-- =========================================================================
-- 1. user_credits
-- =========================================================================

-- 1a. Clean up orphaned rows (user_id not in public.users)
DELETE FROM user_credits
WHERE user_id NOT IN (SELECT id FROM users);

-- 1b. FK: user_credits.user_id → users(id) ON DELETE CASCADE
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_user_credits_user_id'
    ) THEN
        ALTER TABLE user_credits
            ADD CONSTRAINT fk_user_credits_user_id
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;
END $$;

-- 1c. CHECK: balance must never go negative
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_user_credits_balance_non_negative'
    ) THEN
        ALTER TABLE user_credits
            ADD CONSTRAINT chk_user_credits_balance_non_negative
            CHECK (balance >= 0);
    END IF;
END $$;

-- =========================================================================
-- 2. event_promotions
-- =========================================================================

-- 2a. Clean up orphaned rows
DELETE FROM event_promotions
WHERE user_id NOT IN (SELECT id FROM users);

DELETE FROM event_promotions
WHERE event_id NOT IN (SELECT id FROM events);

-- 2b. FK: event_promotions.user_id → users(id) ON DELETE CASCADE
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_event_promotions_user_id'
    ) THEN
        ALTER TABLE event_promotions
            ADD CONSTRAINT fk_event_promotions_user_id
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;
END $$;

-- 2c. FK: event_promotions.event_id → events(id) ON DELETE CASCADE
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_event_promotions_event_id'
    ) THEN
        ALTER TABLE event_promotions
            ADD CONSTRAINT fk_event_promotions_event_id
            FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
    END IF;
END $$;

-- 2d. CHECK: credits_spent must be non-negative
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_event_promotions_credits_non_negative'
    ) THEN
        ALTER TABLE event_promotions
            ADD CONSTRAINT chk_event_promotions_credits_non_negative
            CHECK (credits_spent >= 0);
    END IF;
END $$;

-- 2e. CHECK: end_date must be after start_date
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_event_promotions_date_range'
    ) THEN
        ALTER TABLE event_promotions
            ADD CONSTRAINT chk_event_promotions_date_range
            CHECK (end_date > start_date);
    END IF;
END $$;

-- =========================================================================
-- 3. user_recommendations
-- =========================================================================

-- 3a. Clean up orphaned rows
DELETE FROM user_recommendations
WHERE user_id NOT IN (SELECT id FROM users);

-- 3b. FK: user_recommendations.user_id → users(id) ON DELETE CASCADE
--     Recs are ephemeral (recomputed nightly), so CASCADE is safe.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_user_recommendations_user_id'
    ) THEN
        ALTER TABLE user_recommendations
            ADD CONSTRAINT fk_user_recommendations_user_id
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;
END $$;

-- =========================================================================
-- 4. ab_test_events
-- =========================================================================

-- 4a. Clean up orphaned rows
DELETE FROM ab_test_events
WHERE user_id NOT IN (SELECT id FROM users);

-- 4b. Allow NULL user_id so that ON DELETE SET NULL works.
--     The column was originally NOT NULL; we relax it to preserve aggregate
--     CTR metrics after user deletion.
ALTER TABLE ab_test_events
    ALTER COLUMN user_id DROP NOT NULL;

-- 4c. FK: ab_test_events.user_id → users(id) ON DELETE SET NULL
--     Keeps rows for aggregate A/B metrics after user deletion.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_ab_test_events_user_id'
    ) THEN
        ALTER TABLE ab_test_events
            ADD CONSTRAINT fk_ab_test_events_user_id
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
    END IF;
END $$;
