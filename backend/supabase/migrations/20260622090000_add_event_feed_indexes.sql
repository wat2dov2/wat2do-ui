-- Migration: add_event_feed_indexes
-- Created: 2026-06-22
--
-- Target the hot public event-feed read paths:
--   1. The root feed scans event_dates by upcoming dtstart and needs event_id
--      for dedupe before hydrating only the requested page.
--   2. School-scoped event joins/counts need events(school, id).
--   3. The "latest added" banner reads the newest event per school.
--   4. Promoted-event lookup reads currently-active promotions by end_date
--      and only returns event_id.

BEGIN;

CREATE INDEX IF NOT EXISTS ix_event_dates_dtstart_event_id
    ON public.event_dates (dtstart_utc, event_id);

CREATE INDEX IF NOT EXISTS ix_events_school_id
    ON public.events (school, id);

CREATE INDEX IF NOT EXISTS ix_events_school_added_at_desc
    ON public.events (school, added_at DESC);

CREATE INDEX IF NOT EXISTS ix_event_promotions_end_date_event_id
    ON public.event_promotions (end_date, event_id);

COMMIT;
