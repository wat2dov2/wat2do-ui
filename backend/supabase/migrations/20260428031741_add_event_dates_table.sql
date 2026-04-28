-- Migration: add_event_dates_table
-- Created: 2026-04-28
--
-- Borrows v1's EventDates model so multi-occurrence events stay as a
-- single events row with one event_dates row per occurrence. Today
-- v2's flat schema produces N rows for an N-occurrence event — that
-- breaks "saved one event" / "report one event" semantics and bloats
-- the listing query.
--
-- Migration steps (all in one transaction):
--   1. Create event_dates with FK + RLS + indexes.
--   2. Backfill: one event_dates row per existing events row (only for
--      rows with a non-null dtstart_utc; rows without a date predate
--      this migration's invariants and stay date-less).
--   3. Drop dtstart_utc / dtend_utc from events.
--   4. Create events_listing view that LEFT JOIN-s events × event_dates
--      so existing "list with date filter" code can switch from
--      .table(events) to .table(events_listing) and keep working.
--
-- The view is the read-side compatibility shim. Writers always go
-- through the events + event_dates tables directly (event_service and
-- event_date_service).

BEGIN;

-- 1. Table -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_dates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id integer NOT NULL,
    dtstart_utc timestamptz NOT NULL,
    dtend_utc timestamptz,
    duration text,
    tz text,
    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT chk_event_dates_dtend_after_dtstart
        CHECK (dtend_utc IS NULL OR dtend_utc > dtstart_utc)
);

-- 2. RLS ---------------------------------------------------------------
ALTER TABLE public.event_dates ENABLE ROW LEVEL SECURITY;

-- 3. Foreign key -------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_event_dates_event_id'
    ) THEN
        ALTER TABLE public.event_dates
            ADD CONSTRAINT fk_event_dates_event_id
            FOREIGN KEY (event_id) REFERENCES public.events(id)
            ON DELETE CASCADE;
    END IF;
END$$;

-- 4. Indexes -----------------------------------------------------------
CREATE INDEX IF NOT EXISTS ix_event_dates_event_id
    ON public.event_dates (event_id);
CREATE INDEX IF NOT EXISTS ix_event_dates_dtstart
    ON public.event_dates (dtstart_utc);
CREATE INDEX IF NOT EXISTS ix_event_dates_event_id_dtstart
    ON public.event_dates (event_id, dtstart_utc);

-- 5. Backfill from events --------------------------------------------
-- Each existing event becomes one event_dates row (only for rows that
-- actually carry a date — older rows without a date stay date-less).
INSERT INTO public.event_dates (event_id, dtstart_utc, dtend_utc)
SELECT id, dtstart_utc, dtend_utc
FROM public.events
WHERE dtstart_utc IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM public.event_dates ed WHERE ed.event_id = events.id
  );

-- 6. Drop dtstart_utc / dtend_utc from events ------------------------
ALTER TABLE public.events DROP COLUMN IF EXISTS dtstart_utc;
ALTER TABLE public.events DROP COLUMN IF EXISTS dtend_utc;

-- 7. Listing view ----------------------------------------------------
-- Read-side compatibility shim. One row per (event, occurrence) pair;
-- events with no occurrences still appear once with NULL date columns.
-- Date-range filters on this view behave like v1's Django filter that
-- joined through EventDates.
CREATE OR REPLACE VIEW public.events_listing AS
SELECT
    events.*,
    event_dates.id          AS event_date_id,
    event_dates.dtstart_utc AS dtstart_utc,
    event_dates.dtend_utc   AS dtend_utc,
    event_dates.tz          AS tz
FROM public.events
LEFT JOIN public.event_dates ON event_dates.event_id = events.id;

COMMIT;
