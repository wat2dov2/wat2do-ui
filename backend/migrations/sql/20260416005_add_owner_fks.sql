-- Migration: add owner FKs for events.created_by and clubs.created_by
-- Created: 2026-04-16
-- Depends on: 20260407002000_add_created_by_to_events_and_clubs, 20260406_003_enable_rls_on_existing_tables
--
-- Problem (audit I20): events.created_by and clubs.created_by are TEXT
-- columns storing the Supabase auth UID of the creator.  There is no FK,
-- so deleting a row from public.users leaves "orphan ownership" — the
-- deleted user's JWT (if somehow reused) still matches the created_by,
-- but there is no DB row to look them up from.  The result is a set of
-- events/clubs nobody can edit except admins.
--
-- Design decisions:
--   * FK references public.users(supabase_auth_id) — NOT public.users(id).
--     The created_by column stores the Supabase JWT subject UUID, which
--     is the same value as public.users.supabase_auth_id.  See the
--     terminology note in the audit.
--   * ON DELETE SET NULL.  We do NOT cascade (which would hard-delete all
--     events / clubs owned by the user) because content ownership should
--     outlive the account.  Setting to NULL makes the row admin-only for
--     edit purposes — the right behaviour per
--     ``require_owner_or_admin(..., resource_owner_id=None)`` which only
--     admins can bypass.
--   * A unique constraint on users.supabase_auth_id already exists from
--     the column definition; if not, we add it here (SupabaseAuth IDs
--     are unique by construction).
--
-- Safety:
--   * Orphaned rows are NULL'd before adding the FK so ADD CONSTRAINT
--     cannot fail on existing data.
--   * Each ALTER TABLE uses DO $$ blocks with pg_constraint checks for
--     idempotency.

-- =========================================================================
-- 0. Prerequisite: users.supabase_auth_id must have a unique constraint
--    so it can be referenced as an FK target.
-- =========================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'uq_users_supabase_auth_id'
    ) THEN
        -- Check first if the column already has a unique index via pg_indexes.
        -- If not, create the constraint.  This is defensive: the column is
        -- declared UNIQUE at CREATE TABLE time in most seeds, but older
        -- setups may lack it.
        IF NOT EXISTS (
            SELECT 1 FROM pg_indexes
            WHERE tablename = 'users'
              AND indexname IN ('users_supabase_auth_id_key', 'uq_users_supabase_auth_id')
        ) THEN
            ALTER TABLE users
                ADD CONSTRAINT uq_users_supabase_auth_id UNIQUE (supabase_auth_id);
        END IF;
    END IF;
END $$;

-- =========================================================================
-- 1. events.created_by -> users(supabase_auth_id) ON DELETE SET NULL
-- =========================================================================

-- 1a. NULL out orphaned created_by values so ADD CONSTRAINT does not fail.
UPDATE events
SET created_by = NULL
WHERE created_by IS NOT NULL
  AND created_by NOT IN (SELECT supabase_auth_id FROM users);

-- 1b. Add FK
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_events_created_by'
    ) THEN
        ALTER TABLE events
            ADD CONSTRAINT fk_events_created_by
            FOREIGN KEY (created_by) REFERENCES users(supabase_auth_id) ON DELETE SET NULL;
    END IF;
END $$;

-- =========================================================================
-- 2. clubs.created_by -> users(supabase_auth_id) ON DELETE SET NULL
-- =========================================================================

-- 2a. NULL out orphaned created_by values
UPDATE clubs
SET created_by = NULL
WHERE created_by IS NOT NULL
  AND created_by NOT IN (SELECT supabase_auth_id FROM users);

-- 2b. Add FK
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_clubs_created_by'
    ) THEN
        ALTER TABLE clubs
            ADD CONSTRAINT fk_clubs_created_by
            FOREIGN KEY (created_by) REFERENCES users(supabase_auth_id) ON DELETE SET NULL;
    END IF;
END $$;
