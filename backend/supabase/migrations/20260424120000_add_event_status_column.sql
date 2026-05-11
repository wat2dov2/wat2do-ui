-- Migration: add_event_status_column
-- Created: 2026-04-24
--
-- Adds a ``status`` column to ``events`` to distinguish active events
-- from cancelled ones. Cancellation was previously impossible without
-- hard-deleting the row, which broke two things: (a) the ICS calendar
-- feed had no way to emit ``STATUS:CANCELLED`` so calendar clients
-- silently lost the event rather than seeing it struck through, and
-- (b) planned event-change notifications could not detect cancellation
-- as a material change.
--
-- Semantics:
--   active    — default; event is on, appears in list/search results.
--   cancelled — event was scheduled but is not happening. The public
--               list/search endpoint filters these out by default; an
--               explicit ``include_cancelled=true`` query param opts
--               back in (admin/dashboard contexts). Individual detail
--               and saved-events endpoints always return them so users
--               who saved the event still see the status transition.
--
-- Backfill: NOT NULL DEFAULT 'CONFIRMED' fills every existing row at
-- column-add time, so no separate data migration is needed.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + pg_constraint-guarded CHECK,
-- so re-runs are safe.

BEGIN;

ALTER TABLE public.events
    ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'CONFIRMED';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'events_status_check'
    ) THEN
        ALTER TABLE public.events
            ADD CONSTRAINT events_status_check
            CHECK (status IN ('CONFIRMED', 'CANCELLED'));
    END IF;
END$$;

COMMIT;
