-- Make verified clubs the explicit owners of published events and retire
-- stale manual ingestion queues.

ALTER TABLE public.events
    ADD COLUMN IF NOT EXISTS club_id integer;

UPDATE public.events AS e
SET club_id = c.id
FROM public.clubs AS c
WHERE e.club_id IS NULL
  AND (
      (
          e.ig_handle IS NOT NULL
          AND c.ig IS NOT NULL
          AND lower(trim(e.ig_handle)) = lower(trim(c.ig))
      )
      OR lower(regexp_replace(trim(e.organization), '\s+', ' ', 'g')) =
         lower(regexp_replace(trim(c.club_name), '\s+', ' ', 'g'))
  );

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'events_club_id_fkey'
    ) THEN
        ALTER TABLE public.events
            ADD CONSTRAINT events_club_id_fkey
            FOREIGN KEY (club_id)
            REFERENCES public.clubs(id)
            ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_events_club_id
    ON public.events (club_id);

CREATE OR REPLACE VIEW public.events_listing
WITH (security_invoker = true) AS
SELECT
    events.*,
    event_dates.id          AS event_date_id,
    event_dates.dtstart_utc AS dtstart_utc,
    event_dates.dtend_utc   AS dtend_utc,
    event_dates.tz          AS tz
FROM public.events
LEFT JOIN public.event_dates ON event_dates.event_id = events.id;

REVOKE ALL ON public.events_listing FROM PUBLIC;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE 'REVOKE ALL ON public.events_listing FROM anon';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE 'REVOKE ALL ON public.events_listing FROM authenticated';
    END IF;
END $$;

DROP TABLE IF EXISTS public.event_submissions CASCADE;
DROP TABLE IF EXISTS public.scraped_events CASCADE;
