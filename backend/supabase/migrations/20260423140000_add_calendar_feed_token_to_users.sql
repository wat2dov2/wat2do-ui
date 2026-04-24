-- Migration: add_calendar_feed_token_to_users
-- Created: 2026-04-23
--
-- Adds a per-user opaque token that authorises access to the subscribed
-- ICS calendar feed (GET /calendar/feed/{token}.ics). Nullable; populated
-- lazily the first time a user calls GET /calendar/token. UNIQUE so
-- token -> user_id lookup on the public feed endpoint is a single btree
-- seek.
--
-- No backfill — existing users pick up a token on their next settings
-- page visit, keeping the migration a pure schema change.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + pg_constraint-guarded ADD
-- CONSTRAINT, so re-runs are safe.

BEGIN;

ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS calendar_feed_token text;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_calendar_feed_token_key'
    ) THEN
        ALTER TABLE public.users
            ADD CONSTRAINT users_calendar_feed_token_key UNIQUE (calendar_feed_token);
    END IF;
END$$;

COMMIT;
