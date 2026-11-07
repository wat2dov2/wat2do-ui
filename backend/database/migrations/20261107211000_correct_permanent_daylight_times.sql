-- Move the agent-written times that Postgres put an hour late in British
-- Columbia, Alberta and Manitoba.
--
-- The ingestion agent writes each school time as a wall-clock literal
-- ('2026-11-06 19:30 America/Vancouver'::timestamptz, and positions'
-- deadline_at the same way), so this server's tz database turned it into an
-- instant. Its tz database predates the 2026 changes (see
-- 20261107210000_zone_local_time.sql), so it read every wall-clock time from
-- 2026-11-01 to the next March (and each later winter) at the old winter
-- offset: UBC Symphony Orchestra, Nov 6 7:30 PM, was stored as 03:30Z, not
-- 02:30Z.
--
-- Only rows the agent created are moved: events and positions whose
-- ingestion_source is 'instagram_scraper' (posts and DMs) or 'directory'
-- (directory pages, which the same agent writes). 'manual' and 'submission'
-- rows were converted by the submitter's browser, and 'seed' rows by the seed;
-- neither went through this server's conversion.
--
-- Reading a stored time back with the same old rules gives exactly the literal
-- the agent wrote; local_to_utc turns it into the right instant. Rows the old
-- and new rules agree on (summer dates, other zones, a server whose tz
-- database is already current) come out unchanged and are left alone.
--
-- Each move is recorded in zone_rule_corrections. Running this again would
-- move the corrected rows a second time, so it creates that table without IF
-- NOT EXISTS: a second run fails before touching any row.
--
-- Review before applying (read-only, needs neither function):
--
--   WITH rule(zone, since_utc, utc_offset) AS (VALUES
--       ('America/Vancouver', timestamptz '2026-03-08 10:00+00', interval '-7 hours'),
--       ('America/Edmonton', timestamptz '2026-03-08 09:00+00', interval '-6 hours'),
--       ('America/Winnipeg', timestamptz '2026-03-08 08:00+00', interval '-5 hours')),
--   stored AS (
--       SELECT 'event_date' AS kind, d.id::text AS record_id, e.id AS event_id, e.title,
--           e.ingestion_source, s.slug, r.*, d.created_at, d.dtstart_utc AS old_start,
--           d.dtend_utc AS old_end
--       FROM public.event_dates d
--       JOIN public.events e ON e.id = d.event_id
--       JOIN public.schools s ON s.id = e.school_id
--       JOIN rule r ON r.zone = COALESCE(NULLIF(btrim(d.tz), ''), s.timezone)
--       WHERE e.ingestion_source IN ('instagram_scraper', 'directory')
--       UNION ALL
--       SELECT 'position', p.id::text, NULL, p.title, p.ingestion_source, s.slug, r.*,
--           p.added_at, p.deadline_at, NULL
--       FROM public.positions p
--       JOIN public.schools s ON s.id = p.school_id
--       JOIN rule r ON r.zone = s.timezone
--       WHERE p.ingestion_source IN ('instagram_scraper', 'directory')
--           AND p.deadline_at IS NOT NULL),
--   moved AS (
--       SELECT stored.*, fixed.new_start, fixed_end.new_end
--       FROM stored,
--           LATERAL (SELECT ((old_start AT TIME ZONE zone) - utc_offset) AT TIME ZONE 'UTC' AS t) AS s0,
--           LATERAL (SELECT CASE WHEN s0.t >= since_utc THEN s0.t ELSE old_start END AS new_start) AS fixed,
--           LATERAL (SELECT ((old_end AT TIME ZONE zone) - utc_offset) AT TIME ZONE 'UTC' AS t) AS e0,
--           LATERAL (SELECT CASE WHEN e0.t >= since_utc THEN e0.t ELSE old_end END AS new_end) AS fixed_end)
--   SELECT kind, record_id, event_id, title, ingestion_source, slug, zone, created_at,
--       old_start, new_start, old_end, new_end,
--       to_char(old_start AT TIME ZONE zone, 'Dy YYYY-MM-DD HH24:MI') AS agent_wrote
--   FROM moved
--   WHERE new_start IS DISTINCT FROM old_start OR new_end IS DISTINCT FROM old_end
--   ORDER BY slug, old_start;
--
-- Wrap it in SELECT kind, slug, ingestion_source, count(*) ... GROUP BY 1, 2, 3
-- for the counts. agent_wrote is the poster's wall-clock time; a row a person
-- already corrected by hand shows a time an hour later than its poster and
-- should be left out of this migration before it runs.

BEGIN;

CREATE TABLE public.zone_rule_corrections (
    kind text NOT NULL CHECK (kind IN ('event_date', 'position')),
    record_id text NOT NULL,
    zone text NOT NULL,
    -- dtstart_utc and dtend_utc for an event date, deadline_at for a position.
    old_start timestamptz NOT NULL,
    new_start timestamptz NOT NULL,
    old_end timestamptz,
    new_end timestamptz,
    corrected_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (kind, record_id)
);
ALTER TABLE public.zone_rule_corrections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.zone_rule_corrections FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.zone_rule_corrections TO service_role;

WITH stored AS (
    SELECT
        date.id,
        COALESCE(NULLIF(btrim(date.tz), ''), school.timezone) AS zone,
        date.dtstart_utc,
        date.dtend_utc
    FROM public.event_dates AS date
    JOIN public.events AS event ON event.id = date.event_id
    JOIN public.schools AS school ON school.id = event.school_id
    WHERE event.ingestion_source IN ('instagram_scraper', 'directory')
),
moved AS (
    SELECT
        stored.*,
        public.local_to_utc(stored.dtstart_utc AT TIME ZONE stored.zone, stored.zone) AS new_start,
        public.local_to_utc(stored.dtend_utc AT TIME ZONE stored.zone, stored.zone) AS new_end
    FROM stored
    WHERE EXISTS (SELECT 1 FROM public.zone_permanent_offset(stored.zone))
),
recorded AS (
    INSERT INTO public.zone_rule_corrections (
        kind, record_id, zone, old_start, new_start, old_end, new_end
    )
    SELECT 'event_date', id::text, zone, dtstart_utc, new_start, dtend_utc, new_end
    FROM moved
    WHERE new_start IS DISTINCT FROM dtstart_utc OR new_end IS DISTINCT FROM dtend_utc
    RETURNING record_id, new_start, new_end
)
UPDATE public.event_dates AS date
SET dtstart_utc = recorded.new_start, dtend_utc = recorded.new_end
FROM recorded
WHERE date.id = recorded.record_id::uuid;

WITH moved AS (
    SELECT
        opening.id,
        school.timezone AS zone,
        opening.deadline_at,
        public.local_to_utc(opening.deadline_at AT TIME ZONE school.timezone, school.timezone)
            AS new_deadline
    FROM public.positions AS opening
    JOIN public.schools AS school ON school.id = opening.school_id
    WHERE opening.ingestion_source IN ('instagram_scraper', 'directory')
        AND opening.deadline_at IS NOT NULL
        AND EXISTS (SELECT 1 FROM public.zone_permanent_offset(school.timezone))
),
recorded AS (
    INSERT INTO public.zone_rule_corrections (kind, record_id, zone, old_start, new_start)
    SELECT 'position', id::text, zone, deadline_at, new_deadline
    FROM moved
    WHERE new_deadline <> deadline_at
    RETURNING record_id, new_start
)
UPDATE public.positions AS opening
SET deadline_at = recorded.new_start
FROM recorded
WHERE opening.id = recorded.record_id::bigint;

COMMIT;
