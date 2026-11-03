-- Migration: add_notification_preferences_table
-- Created: 2026-04-24
--
-- Per-user opt-out table for the notifications feature.
--
-- Shape: row-per-(user, type) rather than a bool column per type on the
-- users table. Rationale: v2/v3 of notifications will add new types
-- (push, followed-club, etc.) — keeping prefs in rows means a new type
-- is a code change only, no migration. ``notification_type`` is plain
-- text with no CHECK; the canonical list lives in core/constants.py as
-- a Literal so Pydantic validates incoming updates at the API boundary.
--
-- Semantics:
--   row present, enabled=true   — user has explicitly opted in
--   row present, enabled=false  — user has explicitly opted out
--   row absent                  — code default-on (see
--                                 notification_service.DEFAULT_ENABLED)
--
-- The send-worker calls ``is_enabled(user, type)`` which joins through
-- this table; missing rows resolve to the code default so newly added
-- types auto-apply to existing users without a backfill.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + pg_constraint-guarded FKs
-- + IF NOT EXISTS indexes.

BEGIN;

-- 1. Table -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_preferences (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    notification_type text NOT NULL,
    enabled boolean NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT notification_preferences_user_type_key
        UNIQUE (user_id, notification_type)
);

-- 2. RLS ---------------------------------------------------------------
-- Service-role bypasses RLS; enabling with no policies blocks the
-- anon / authenticated roles in case any future code path uses the
-- anon client.
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

-- 3. Foreign keys ------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_notification_preferences_user_id'
    ) THEN
        ALTER TABLE public.notification_preferences
            ADD CONSTRAINT fk_notification_preferences_user_id
            FOREIGN KEY (user_id) REFERENCES public.users(id)
            ON DELETE CASCADE;
    END IF;
END$$;

-- 4. Indexes -----------------------------------------------------------
CREATE INDEX IF NOT EXISTS ix_notification_preferences_user_id
    ON public.notification_preferences (user_id);

COMMIT;
