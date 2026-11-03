-- Soft-cancel flag for scraped/API events. Cancelled events stay in the
-- default feed; clients may filter with an optional chip.
ALTER TABLE public.events
    ADD COLUMN IF NOT EXISTS cancelled boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS ix_events_cancelled
    ON public.events (cancelled)
    WHERE cancelled = true;
