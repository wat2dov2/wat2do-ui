-- Migration: unify_created_by_to_internal_id
-- Created: 2026-04-23
--
-- Unifies the two ownership conventions in this codebase. Before this
-- migration:
--   * events.created_by, clubs.created_by, qr_codes.created_by stored
--     users.supabase_auth_id (the JWT "sub" claim) as text.
--   * Every other per-user table stored users.id (internal UUID PK).
-- The split forced two kinds of owner-check logic in the service/router
-- layer. This migration collapses the first group into the second:
-- created_by is now a UUID FK'd to users.id, matching every other
-- per-user table.
--
-- Strategy per table:
--   1. Drop the CHECK constraint on the UUID-format text (the uuid type
--      will enforce it going forward).
--   2. Drop the FK to users(supabase_auth_id).
--   3. ALTER COLUMN TYPE text -> uuid with a USING clause that joins
--      through users on supabase_auth_id to produce the internal id.
--      Rows whose created_by doesn't match any user become NULL
--      (orphan-safe for events/clubs; qr_codes guards this separately
--      since the column is NOT NULL).
--   4. Add the new FK to users(id) with ON DELETE SET NULL (or CASCADE
--      for qr_codes since those posters are meaningless without an
--      owner).
--
-- Idempotent via pg_constraint / DO blocks so partial runs can be
-- retried.

BEGIN;

-- ────────────────────────────────────────────────────────────────────
-- 1. Pre-flight: clean up orphan qr_codes so the type change doesn't
--    leave NULLs in a NOT NULL column. For events/clubs the column is
--    nullable so any unmatched rows legitimately become NULL.
-- ────────────────────────────────────────────────────────────────────

DELETE FROM qr_codes
WHERE created_by IS NOT NULL
  AND created_by NOT IN (SELECT supabase_auth_id FROM users);

-- ────────────────────────────────────────────────────────────────────
-- 2. events.created_by:  text(supabase_auth_id) -> uuid(users.id)
-- ────────────────────────────────────────────────────────────────────

ALTER TABLE events DROP CONSTRAINT IF EXISTS chk_events_created_by_uuid_format;
ALTER TABLE events DROP CONSTRAINT IF EXISTS fk_events_created_by;

ALTER TABLE events
    ALTER COLUMN created_by TYPE uuid
    USING (
        CASE
            WHEN created_by IS NULL THEN NULL
            ELSE (SELECT id FROM users WHERE supabase_auth_id = events.created_by)
        END
    );

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_events_created_by'
    ) THEN
        ALTER TABLE events
            ADD CONSTRAINT fk_events_created_by
            FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
    END IF;
END$$;

-- ────────────────────────────────────────────────────────────────────
-- 3. clubs.created_by:  text(supabase_auth_id) -> uuid(users.id)
-- ────────────────────────────────────────────────────────────────────

ALTER TABLE clubs DROP CONSTRAINT IF EXISTS chk_clubs_created_by_uuid_format;
ALTER TABLE clubs DROP CONSTRAINT IF EXISTS fk_clubs_created_by;

ALTER TABLE clubs
    ALTER COLUMN created_by TYPE uuid
    USING (
        CASE
            WHEN created_by IS NULL THEN NULL
            ELSE (SELECT id FROM users WHERE supabase_auth_id = clubs.created_by)
        END
    );

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_clubs_created_by'
    ) THEN
        ALTER TABLE clubs
            ADD CONSTRAINT fk_clubs_created_by
            FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
    END IF;
END$$;

-- ────────────────────────────────────────────────────────────────────
-- 4. qr_codes.created_by:  varchar(supabase_auth_id) -> uuid(users.id)
--    NOT NULL. Orphans were deleted in step 1 so the USING clause
--    cannot produce a NULL row here.
-- ────────────────────────────────────────────────────────────────────

ALTER TABLE qr_codes DROP CONSTRAINT IF EXISTS chk_qr_codes_created_by_uuid_format;

ALTER TABLE qr_codes
    ALTER COLUMN created_by TYPE uuid
    USING (SELECT id FROM users WHERE supabase_auth_id = qr_codes.created_by);

ALTER TABLE qr_codes ALTER COLUMN created_by SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_qr_codes_created_by'
    ) THEN
        ALTER TABLE qr_codes
            ADD CONSTRAINT fk_qr_codes_created_by
            FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE;
    END IF;
END$$;

-- Indexes on created_by remain valid across the type change (Postgres
-- keeps btree indexes on altered columns when the USING clause is
-- deterministic). No index work needed.

COMMIT;
