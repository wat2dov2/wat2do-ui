-- Wall-clock conversions that follow current law even where this server's tz
-- database is older.
--
-- British Columbia, Alberta and Manitoba sprang forward on 2026-03-08 for the
-- last time: since then America/Vancouver, America/Edmonton and
-- America/Winnipeg stay on UTC-07, -06 and -05 all year (tz releases 2026b,
-- 2026c and 2026e). A Postgres built with an older tz database still falls
-- back on 2026-11-01, so `'... America/Vancouver'::timestamptz` and
-- `AT TIME ZONE 'America/Vancouver'` read winter times an hour off.
-- Production's Homebrew Postgres carries the tz database of its minor release,
-- so these functions do not wait for an upgrade: every place that turns a
-- school's wall-clock time into an instant, or back, goes through them. For
-- every other zone, and for these zones before the change, they are plain
-- AT TIME ZONE. A zone whose law changes again gets a row in
-- zone_permanent_offset; rust/src/ingestion/database_tests.rs checks both
-- functions against the tz database Rust bundles.

BEGIN;

-- From since_utc on, the zone keeps one UTC offset all year.
CREATE OR REPLACE FUNCTION public.zone_permanent_offset(zone text)
RETURNS TABLE (since_utc timestamptz, utc_offset interval)
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
    SELECT rule.since_utc, rule.utc_offset
    FROM (VALUES
        ('America/Vancouver', timestamptz '2026-03-08 10:00+00', interval '-7 hours'),
        ('America/Edmonton', timestamptz '2026-03-08 09:00+00', interval '-6 hours'),
        ('America/Winnipeg', timestamptz '2026-03-08 08:00+00', interval '-5 hours')
    ) AS rule(zone, since_utc, utc_offset)
    WHERE rule.zone = zone_permanent_offset.zone
$$;

-- The instant a wall-clock time in `zone` names.
CREATE OR REPLACE FUNCTION public.local_to_utc(local_time timestamp, zone text)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = public
AS $$
    SELECT COALESCE(
        (
            SELECT fixed.instant
            FROM public.zone_permanent_offset(zone) AS rule,
                LATERAL (SELECT (local_time - rule.utc_offset) AT TIME ZONE 'UTC' AS instant) AS fixed
            WHERE fixed.instant >= rule.since_utc
        ),
        local_time AT TIME ZONE zone
    )
$$;

-- The wall-clock time in `zone` at an instant.
CREATE OR REPLACE FUNCTION public.utc_to_local(instant timestamptz, zone text)
RETURNS timestamp
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = public
AS $$
    SELECT COALESCE(
        (
            SELECT (instant AT TIME ZONE 'UTC') + rule.utc_offset
            FROM public.zone_permanent_offset(zone) AS rule
            WHERE instant >= rule.since_utc
        ),
        instant AT TIME ZONE zone
    )
$$;

REVOKE ALL ON FUNCTION public.zone_permanent_offset(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.local_to_utc(timestamp, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.utc_to_local(timestamptz, text) FROM PUBLIC;
-- The ingestion agent writes and reads every school time through them.
GRANT EXECUTE ON FUNCTION public.zone_permanent_offset(text),
    public.local_to_utc(timestamp, text),
    public.utc_to_local(timestamptz, text)
    TO wat2do_ingest_agent, service_role;

COMMIT;
