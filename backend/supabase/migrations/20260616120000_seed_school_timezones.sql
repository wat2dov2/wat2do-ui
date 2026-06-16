-- Set IANA timezones for every school slug in the directory.
-- Supabase is the source of truth; backend loads these into SCHOOL_TIMEZONES at startup.

BEGIN;

WITH school_timezones(slug, timezone) AS (
  VALUES
    ('uwaterloo', 'America/Toronto'),
    ('utoronto',  'America/Toronto'),
    ('utsc',      'America/Toronto'),
    ('mcgill',    'America/Toronto'),
    ('mcmaster',  'America/Toronto'),
    ('western',   'America/Toronto'),
    ('queens',    'America/Toronto'),
    ('carleton',  'America/Toronto'),
    ('brock',     'America/Toronto'),
    ('wlu',       'America/Toronto'),
    ('york',      'America/Toronto'),
    ('tmu',       'America/Toronto'),
    ('uottawa',   'America/Toronto'),
    ('ocad',      'America/Toronto'),
    ('cornell',   'America/New_York'),
    ('nyu',       'America/New_York'),
    ('upenn',     'America/New_York'),
    ('columbia',  'America/New_York'),
    ('mit',       'America/New_York'),
    ('ubc',       'America/Vancouver'),
    ('berkeley',  'America/Los_Angeles')
)
UPDATE public.schools s
SET timezone = tz.timezone
FROM school_timezones tz
WHERE s.name = tz.slug
  AND (s.timezone IS DISTINCT FROM tz.timezone);

NOTIFY pgrst, 'reload schema';

COMMIT;
