-- Add schools + school_email_domains tables to make Supabase the source of truth
-- for the {email-domain -> school} mapping (replacing the bundled
-- world_universities_and_domains.json) and for school metadata used by clubs,
-- events, users, and the process-single-user GitHub Action.
--
-- This migration only introduces the new tables and seeds them.  It does NOT
-- yet add a school_id FK on clubs / events / users / pending_submissions —
-- those tables continue to use the existing varchar `school` column whose
-- values must match `schools.name`.  The existing UofT seed rows ("University
-- of Toronto") are renamed to "University of Toronto - St. George" so they
-- align with the new canonical names.
--
-- Idempotent: safe to re-run after the full migration history.

BEGIN;

-- 1. Tables -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.schools (
    id                   serial PRIMARY KEY,
    name                 varchar(255) NOT NULL UNIQUE,
    slug                 varchar(64)  NOT NULL UNIQUE,
    timezone             varchar(64),
    semester_fall_end    timestamptz,
    semester_spring_end  timestamptz,
    semester_summer_end  timestamptz,
    created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.school_email_domains (
    id          serial PRIMARY KEY,
    school_id   integer NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    domain      varchar(255) NOT NULL UNIQUE,
    is_primary  boolean NOT NULL DEFAULT false,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_school_email_domains_school_id
    ON public.school_email_domains(school_id);

-- 2. Seed schools (canonical long names) ------------------------------------
-- Slugs are kebab-case to keep them URL-friendly and stable.
-- Timezones / semester anchors are populated only for Waterloo, matching the
-- existing constants in backend/core/constants/schools.py — every other
-- school keeps null and falls back through the same code path it does today.

INSERT INTO public.schools (name, slug, timezone, semester_fall_end, semester_spring_end, semester_summer_end)
VALUES
  ('University of Waterloo',                'university-of-waterloo',     'America/Toronto',
       '2025-12-31 23:59:59+00', '2026-04-30 23:59:59+00', '2026-08-31 23:59:59+00'),
  ('University of Toronto - St. George',    'uoft-st-george',             'America/Toronto', NULL, NULL, NULL),
  ('University of Toronto - Scarborough',   'uoft-scarborough',           'America/Toronto', NULL, NULL, NULL),
  ('McGill University',                     'mcgill-university',          'America/Toronto', NULL, NULL, NULL),
  ('McMaster University',                   'mcmaster-university',        'America/Toronto', NULL, NULL, NULL),
  ('Western University',                    'western-university',         'America/Toronto', NULL, NULL, NULL),
  ('Queen''s University',                   'queens-university',          'America/Toronto', NULL, NULL, NULL),
  ('Carleton University',                   'carleton-university',        'America/Toronto', NULL, NULL, NULL),
  ('Brock University',                      'brock-university',           'America/Toronto', NULL, NULL, NULL),
  ('Wilfrid Laurier University',            'wilfrid-laurier-university', 'America/Toronto', NULL, NULL, NULL),
  ('York University',                       'york-university',            'America/Toronto', NULL, NULL, NULL),
  ('Toronto Metropolitan University',       'toronto-metropolitan',       'America/Toronto', NULL, NULL, NULL),
  ('University of Ottawa',                  'university-of-ottawa',       'America/Toronto', NULL, NULL, NULL),
  ('OCAD University',                       'ocad-university',            'America/Toronto', NULL, NULL, NULL),
  ('Cornell University',                    'cornell-university',         'America/New_York', NULL, NULL, NULL),
  ('New York University',                   'new-york-university',        'America/New_York', NULL, NULL, NULL),
  ('University of Pennsylvania',            'university-of-pennsylvania', 'America/New_York', NULL, NULL, NULL),
  ('Columbia University',                   'columbia-university',        'America/New_York', NULL, NULL, NULL),
  ('Massachusetts Institute of Technology', 'mit',                        'America/New_York', NULL, NULL, NULL),
  ('University of British Columbia',        'ubc',                        'America/Vancouver', NULL, NULL, NULL)
ON CONFLICT (name) DO NOTHING;

-- 3. Seed email domains -----------------------------------------------------
-- Domains are pulled from the prior world_universities_and_domains.json
-- snapshot.  Waterloo also keeps `edu.uwaterloo.ca` from FALLBACK_DOMAINS.
-- TMU keeps the legacy `ryerson.ca` so older accounts still resolve.
-- UofT - Scarborough has its own subdomain `scar.utoronto.ca`; the bare
-- utoronto.ca / toronto.edu / mail.utoronto.ca all default to St. George.

WITH school_lookup AS (
  SELECT id, name FROM public.schools
)
INSERT INTO public.school_email_domains (school_id, domain, is_primary)
SELECT s.id, d.domain, d.is_primary
FROM (VALUES
  ('University of Waterloo',                'uwaterloo.ca',     true),
  ('University of Waterloo',                'edu.uwaterloo.ca', false),

  ('University of Toronto - St. George',    'utoronto.ca',      true),
  ('University of Toronto - St. George',    'mail.utoronto.ca', false),
  ('University of Toronto - St. George',    'toronto.edu',      false),
  ('University of Toronto - Scarborough',   'scar.utoronto.ca', true),

  ('McGill University',                     'mcgill.ca',        true),
  ('McGill University',                     'mail.mcgill.ca',   false),
  ('McMaster University',                   'mcmaster.ca',      true),
  ('Western University',                    'uwo.ca',           true),
  ('Queen''s University',                   'queensu.ca',       true),
  ('Carleton University',                   'carleton.ca',      true),
  ('Brock University',                      'brocku.ca',        true),
  ('Wilfrid Laurier University',            'wlu.ca',           true),
  ('Wilfrid Laurier University',            'mylaurier.ca',     false),
  ('York University',                       'yorku.ca',         true),
  ('Toronto Metropolitan University',       'torontomu.ca',     true),
  ('Toronto Metropolitan University',       'ryerson.ca',       false),
  ('University of Ottawa',                  'uottawa.ca',       true),
  ('OCAD University',                       'ocadu.ca',         true),

  ('Cornell University',                    'cornell.edu',      true),
  ('New York University',                   'nyu.edu',          true),
  ('University of Pennsylvania',            'upenn.edu',        true),
  ('University of Pennsylvania',            'seas.upenn.edu',   false),
  ('Columbia University',                   'columbia.edu',     true),
  ('Massachusetts Institute of Technology', 'mit.edu',          true),

  ('University of British Columbia',        'ubc.ca',           true),
  ('University of British Columbia',        'student.ubc.ca',   false)
) AS d(school_name, domain, is_primary)
JOIN school_lookup s ON s.name = d.school_name
ON CONFLICT (domain) DO NOTHING;

-- 4. Re-canonicalize existing UofT rows -------------------------------------
-- The previous seed migration (20260525010800) inserted clubs with
-- school = 'University of Toronto'.  Update those (and any users / events
-- carrying the legacy value) to the new canonical name so the email domain
-- lookup and the schools row remain consistent.

UPDATE public.clubs    SET school = 'University of Toronto - St. George'
  WHERE school = 'University of Toronto';
UPDATE public.users    SET school = 'University of Toronto - St. George'
  WHERE school = 'University of Toronto';
UPDATE public.events   SET school = 'University of Toronto - St. George'
  WHERE school = 'University of Toronto';

NOTIFY pgrst, 'reload schema';

COMMIT;
