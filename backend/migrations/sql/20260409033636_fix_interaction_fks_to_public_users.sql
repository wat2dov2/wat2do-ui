-- Migration: fix user_interactions and user_saved_events FKs to reference public.users
-- Created: 2026-04-09
-- Depends on: 20260406_000_create_recommendation_tables,
--             20260409031953_add_missing_fks_and_checks
--
-- Problem: the original 20260406_000 migration declared:
--
--     user_interactions.user_id  REFERENCES auth.users(id)
--     user_saved_events.user_id  REFERENCES auth.users(id)
--
--   but the application stores public.users.id (an independent UUID) in all
--   user_id columns (via resolve_db_user -> db_user.id).  auth.users.id is
--   a different UUID stored in public.users.supabase_auth_id.
--
--   The fix migration 20260409031953 added correct FKs (to public.users) for
--   user_recommendations and ab_test_events, but did not correct these two
--   tables.
--
--   In practice the tables were created manually before the migration system
--   existed (CREATE TABLE IF NOT EXISTS), so the incorrect FK may never have
--   been applied in production.  This migration handles both cases:
--
--     1. If the auth.users FK exists  -> drop it, add the correct one
--     2. If no FK exists at all       -> add the correct one
--     3. If the correct FK exists     -> no-op (idempotent)
--
-- Safety:
--   * Orphaned rows (user_id not in public.users) are cleaned before adding
--     the new constraint so ADD CONSTRAINT cannot fail on stale data.
--   * All blocks use DO $$ with pg_constraint checks for idempotency.

-- =========================================================================
-- 1. user_interactions  (user_id -> public.users(id) ON DELETE SET NULL)
-- =========================================================================

-- 1a. Drop the incorrect FK referencing auth.users if it exists.
--     The auto-generated constraint name is user_interactions_user_id_fkey.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'user_interactions_user_id_fkey'
    ) THEN
        ALTER TABLE user_interactions
            DROP CONSTRAINT user_interactions_user_id_fkey;
    END IF;
END $$;

-- 1b. Clean up orphaned rows whose user_id does not exist in public.users.
DELETE FROM user_interactions
WHERE user_id IS NOT NULL
  AND user_id NOT IN (SELECT id FROM users);

-- 1c. Add the correct FK.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_user_interactions_user_id'
    ) THEN
        ALTER TABLE user_interactions
            ADD CONSTRAINT fk_user_interactions_user_id
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
    END IF;
END $$;

-- =========================================================================
-- 2. user_saved_events  (user_id -> public.users(id) ON DELETE CASCADE)
-- =========================================================================

-- 2a. Drop the incorrect FK referencing auth.users if it exists.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'user_saved_events_user_id_fkey'
    ) THEN
        ALTER TABLE user_saved_events
            DROP CONSTRAINT user_saved_events_user_id_fkey;
    END IF;
END $$;

-- 2b. Clean up orphaned rows.
DELETE FROM user_saved_events
WHERE user_id NOT IN (SELECT id FROM users);

-- 2c. Add the correct FK.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_user_saved_events_user_id'
    ) THEN
        ALTER TABLE user_saved_events
            ADD CONSTRAINT fk_user_saved_events_user_id
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;
END $$;
