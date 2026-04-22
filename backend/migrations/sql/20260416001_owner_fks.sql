-- Migration: owner_fks
-- Created: 2026-04-16
--
-- Fixes audit finding D6 (partially — scope: events.created_by,
-- clubs.created_by, qr_codes.created_by).  The routers agent owns FKs on
-- event_submissions.user_id and reported_events.user_id.
--
-- Problem: these three created_by columns store a Supabase auth UID
-- (the JWT `sub`, i.e. auth.users.id) but are typed plain TEXT with no
-- constraint.  Any string is accepted, so a typo or direct SQL edit can
-- produce a non-UUID value that never matches the caller's JWT sub,
-- silently locking the real owner out of their own resource.
--
-- Options considered:
--   (a) Convert column to UUID + FOREIGN KEY to auth.users(id)
--       ON DELETE SET NULL.  Rejected — the `auth` schema is managed by
--       Supabase and direct FKs across schemas to it are brittle;
--       additionally, altering a TEXT column to UUID against existing
--       production data requires every row to be a valid UUID, which
--       cannot be guaranteed here (the very bug being fixed).
--   (b) Add a CHECK constraint enforcing UUID format.  Keeps the
--       column type stable, rejects garbage writes going forward, and
--       succeeds even if a small number of existing rows are malformed
--       (we normalize those first).
--
-- Chose (b).  This prevents the "non-UUID stored in created_by" class of
-- bug (the concrete trigger in the audit) without cross-schema FK
-- coupling to auth.users.
--
-- A case-insensitive 8-4-4-4-12 hex regex is used, which accepts any
-- UUID variant (v4 from Supabase auth, v1, v5, etc.).
--
-- Idempotent via pg_constraint guards.

-- Regex literal shared across all three tables.
-- PostgreSQL ~* is case-insensitive.  Matches canonical UUID form only.
-- NOTE: we use a Perl-compatible regex style supported by PostgreSQL's
-- POSIX regexes (no \b anchors, inline character classes are fine).

-- =========================================================================
-- 1. events.created_by
-- =========================================================================

-- 1a. Normalize any non-UUID values to NULL so the CHECK does not fail.
--     Rows with non-UUID ownership become "unowned" (editable only by
--     admins per require_owner_or_admin's NULL handling).
UPDATE events
SET created_by = NULL
WHERE created_by IS NOT NULL
  AND created_by !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

-- 1b. Add CHECK constraint.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_events_created_by_uuid_format'
    ) THEN
        ALTER TABLE events
            ADD CONSTRAINT chk_events_created_by_uuid_format
            CHECK (
                created_by IS NULL
                OR created_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            );
    END IF;
END $$;

-- =========================================================================
-- 2. clubs.created_by
-- =========================================================================

UPDATE clubs
SET created_by = NULL
WHERE created_by IS NOT NULL
  AND created_by !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_clubs_created_by_uuid_format'
    ) THEN
        ALTER TABLE clubs
            ADD CONSTRAINT chk_clubs_created_by_uuid_format
            CHECK (
                created_by IS NULL
                OR created_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            );
    END IF;
END $$;

-- =========================================================================
-- 3. qr_codes.created_by
-- =========================================================================
-- qr_codes.created_by is NOT NULL (see 20260416001_create_qr_tables.sql),
-- so we cannot fall back to NULL for drifted rows.  The only safe option
-- is to delete QR codes whose created_by is not a UUID — such rows are
-- unowned and unauthenticatable through the normal API (no JWT sub will
-- ever match a non-UUID string).  The scans are cleaned up via the
-- ON DELETE CASCADE FK added in 20260416001_create_qr_tables.sql.
DELETE FROM qr_codes
WHERE created_by IS NULL
   OR created_by !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_qr_codes_created_by_uuid_format'
    ) THEN
        ALTER TABLE qr_codes
            ADD CONSTRAINT chk_qr_codes_created_by_uuid_format
            CHECK (
                created_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            );
    END IF;
END $$;
