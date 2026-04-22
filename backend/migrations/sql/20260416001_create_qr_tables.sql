-- Migration: create_qr_tables
-- Created: 2026-04-16
--
-- Fixes audit finding D5 and D7: the qr_codes and qr_code_scans tables
-- were created manually outside the SQL migration system.  The only
-- definition lived in a legacy Alembic file
-- (migrations/versions/a1b2c3d4e5f6_add_qr_codes_and_scans.py) which per
-- CLAUDE.md was never runnable.  A fresh Supabase environment running
-- `scripts/migrate.py apply` would fail to create these tables, and the
-- 20260406_003_enable_rls_on_existing_tables migration would then fail
-- because it ALTERs tables that do not exist.
--
-- This migration brings both tables into the canonical schema, with:
--   * Proper primary keys (qr_codes.id is client-supplied, qr_code_scans.id
--     is a UUID).
--   * FOREIGN KEY qr_code_scans.qr_code_id -> qr_codes(id) ON DELETE CASCADE
--     so deleting a QR code removes its scans rather than leaving orphans.
--   * ENABLE ROW LEVEL SECURITY per project policy (CLAUDE.md requires
--     RLS on every public table).
--
-- Column shapes mirror services/qr_code_service.py and schemas/qr_code.py.
-- FK on qr_codes.created_by is handled in the companion owner_fks migration
-- (20260416001_owner_fks.sql).
--
-- All statements are idempotent so this migration is safe to apply against
-- production DBs where the tables already exist.

-- =========================================================================
-- 1. qr_codes
-- =========================================================================

CREATE TABLE IF NOT EXISTS qr_codes (
    id                VARCHAR(64)  PRIMARY KEY,
    name              VARCHAR(255) NOT NULL,
    description       TEXT,
    destination_type  VARCHAR(32)  NOT NULL,
    destination_id    VARCHAR(512),
    filters           JSONB,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by        TEXT         NOT NULL,
    is_active         BOOLEAN      NOT NULL DEFAULT FALSE,
    image_url         VARCHAR(1024),
    latitude          DOUBLE PRECISION NOT NULL DEFAULT 0,
    longitude         DOUBLE PRECISION NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_qr_codes_created_by ON qr_codes (created_by);
CREATE INDEX IF NOT EXISTS idx_qr_codes_created_at ON qr_codes (created_at DESC);

-- Validate destination_type at the DB layer (mirrors
-- schemas.qr_code.QrDestinationType).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_qr_codes_destination_type_valid'
    ) THEN
        ALTER TABLE qr_codes
            ADD CONSTRAINT chk_qr_codes_destination_type_valid
            CHECK (destination_type IN ('event', 'events-list', 'custom-url'));
    END IF;
END $$;

-- =========================================================================
-- 2. qr_code_scans
-- =========================================================================

CREATE TABLE IF NOT EXISTS qr_code_scans (
    id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    qr_code_id          VARCHAR(64)  NOT NULL,
    scanned_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    user_id             TEXT,
    session_id          VARCHAR(255) NOT NULL,
    conversion_actions  JSONB        NOT NULL DEFAULT '[]'::jsonb,
    user_agent          VARCHAR(512)
);

CREATE INDEX IF NOT EXISTS idx_qr_code_scans_qr_code_id ON qr_code_scans (qr_code_id);
CREATE INDEX IF NOT EXISTS idx_qr_code_scans_scanned_at ON qr_code_scans (scanned_at DESC);

-- =========================================================================
-- 3. FK: qr_code_scans.qr_code_id -> qr_codes(id) ON DELETE CASCADE
-- =========================================================================

-- Clean up orphans that may have accumulated before the FK existed.  Use
-- NOT EXISTS (null-safe) rather than NOT IN to avoid silent no-ops.
DELETE FROM qr_code_scans s
WHERE NOT EXISTS (
    SELECT 1 FROM qr_codes q WHERE q.id = s.qr_code_id
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_qr_code_scans_qr_code_id'
    ) THEN
        ALTER TABLE qr_code_scans
            ADD CONSTRAINT fk_qr_code_scans_qr_code_id
            FOREIGN KEY (qr_code_id) REFERENCES qr_codes(id) ON DELETE CASCADE;
    END IF;
END $$;

-- =========================================================================
-- 4. Row Level Security (service_role bypasses; blocks anon/authenticated)
-- =========================================================================
ALTER TABLE qr_codes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE qr_code_scans ENABLE ROW LEVEL SECURITY;
