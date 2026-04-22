-- Migration: users_role_check
-- Created: 2026-04-16
--
-- Fixes audit finding D2: users.role is plain TEXT with no CHECK constraint,
-- so typos like 'Admin' (capital), 'admin ' (trailing space), or
-- 'administrator' are silently accepted and then never match the
-- application's exact-equality ROLE_ADMIN = 'admin' check, locking the
-- user out of admin privileges without any indication.
--
-- This migration:
--   1. Normalizes any drifted values to the canonical set {'user','admin'}
--      (trimmed + lower-cased) so the CHECK constraint does not fail on
--      existing data.
--   2. Adds CHECK (role IN ('user','admin')) — rejects invalid values
--      at the DB layer going forward.
--
-- Idempotent: guarded by pg_constraint lookup.

-- 1. Normalize any drifted values.  Trim whitespace and lowercase; any
--    string not matching an allowed value falls back to 'user' (the
--    default for new rows).  This is safe — a real admin whose role
--    was mistyped needs to be re-promoted by another admin.
UPDATE users
SET role = CASE
    WHEN lower(btrim(role)) = 'admin' THEN 'admin'
    WHEN lower(btrim(role)) = 'user'  THEN 'user'
    ELSE 'user'
END
WHERE role IS NULL
   OR role NOT IN ('user', 'admin');

-- 2. Add CHECK constraint.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_users_role_valid'
    ) THEN
        ALTER TABLE users
            ADD CONSTRAINT chk_users_role_valid
            CHECK (role IN ('user', 'admin'));
    END IF;
END $$;
