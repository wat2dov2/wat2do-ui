-- Make schools the single source of truth for school identity, routing, and
-- calendar context.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'schools'
      AND column_name = 'name'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'schools'
      AND column_name = 'slug'
  ) THEN
    ALTER TABLE public.schools RENAME COLUMN name TO slug;
  END IF;
END
$$;

ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS name varchar(255),
  ADD COLUMN IF NOT EXISTS timezone varchar(255),
  ADD COLUMN IF NOT EXISTS recipient_id varchar(32),
  ADD COLUMN IF NOT EXISTS semester_start date,
  ADD COLUMN IF NOT EXISTS semester_end date;

INSERT INTO public.schools (
  slug,
  name,
  timezone,
  recipient_id,
  semester_start,
  semester_end
)
VALUES
  (
    'uwaterloo',
    'University of Waterloo',
    'America/Toronto',
    '76214170483',
    '2026-05-01',
    '2026-08-31'
  ),
  ('utoronto', 'University of Toronto St. George', 'America/Toronto', '46189693055', NULL, NULL),
  ('utsc', 'University of Toronto Scarborough', 'America/Toronto', '42534550681', NULL, NULL),
  ('utm', 'University of Toronto Mississauga', 'America/Toronto', '78383689040', NULL, NULL),
  ('mcgill', 'McGill University', 'America/Toronto', '41798261998', NULL, NULL),
  ('mcmaster', 'McMaster University', 'America/Toronto', '45870501433', NULL, NULL),
  ('western', 'University of Western Ontario', 'America/Toronto', '10484310032', NULL, NULL),
  ('queens', 'Queen''s University', 'America/Toronto', '12916544321', NULL, NULL),
  ('carleton', 'Carleton University', 'America/Toronto', '48377203732', NULL, NULL),
  ('brock', 'Brock University', 'America/Toronto', '43006702072', NULL, NULL),
  ('wlu', 'Wilfrid Laurier University', 'America/Toronto', '15810604755', NULL, NULL),
  ('york', 'York University', 'America/Toronto', '15093515058', NULL, NULL),
  ('tmu', 'Toronto Metropolitan University', 'America/Toronto', '42518030160', NULL, NULL),
  ('uottawa', 'University of Ottawa', 'America/Toronto', '43530696650', NULL, NULL),
  ('ocad', 'OCAD University', 'America/Toronto', '15337624395', NULL, NULL),
  ('ualberta', 'University of Alberta', 'America/Edmonton', '48380948133', NULL, NULL),
  ('laval', 'Université Laval', 'America/Toronto', '43532737476', NULL, NULL),
  ('memorial', 'Memorial University of Newfoundland', 'America/St_Johns', '41810288468', NULL, NULL),
  ('sfu', 'Simon Fraser University', 'America/Vancouver', '39852281481', NULL, NULL),
  ('udem', 'Université de Montréal', 'America/Toronto', '40832094597', NULL, NULL),
  ('umanitoba', 'University of Manitoba', 'America/Winnipeg', '43288772004', NULL, NULL),
  ('concordia', 'Concordia University', 'America/Toronto', '40080547452', NULL, NULL),
  ('dalhousie', 'Dalhousie University', 'America/Halifax', '49365179941', NULL, NULL),
  ('guelph', 'University of Guelph', 'America/Toronto', '45481970934', NULL, NULL),
  ('ucalgary', 'University of Calgary', 'America/Edmonton', '9510252848', NULL, NULL),
  ('usask', 'University of Saskatchewan', 'America/Regina', '41553815702', NULL, NULL),
  ('uvic', 'University of Victoria', 'America/Vancouver', NULL, NULL, NULL),
  ('windsor', 'University of Windsor', 'America/Toronto', '45460825687', NULL, NULL),
  ('uqam', 'Université du Québec à Montréal', 'America/Toronto', NULL, NULL, NULL),
  ('ontariotech', 'Ontario Tech University', 'America/Toronto', NULL, NULL, NULL),
  ('cornell', 'Cornell University', 'America/New_York', NULL, NULL, NULL),
  ('nyu', 'New York University', 'America/New_York', NULL, NULL, NULL),
  ('upenn', 'University of Pennsylvania', 'America/New_York', NULL, NULL, NULL),
  ('columbia', 'Columbia University', 'America/New_York', NULL, NULL, NULL),
  ('mit', 'Massachusetts Institute of Technology', 'America/New_York', NULL, NULL, NULL),
  ('ubc', 'University of British Columbia', 'America/Vancouver', '12342599092', NULL, NULL),
  ('berkeley', 'University of California, Berkeley', 'America/Los_Angeles', NULL, NULL, NULL)
ON CONFLICT (slug) DO UPDATE
SET
  name = EXCLUDED.name,
  timezone = EXCLUDED.timezone,
  recipient_id = EXCLUDED.recipient_id,
  semester_start = EXCLUDED.semester_start,
  semester_end = EXCLUDED.semester_end;

UPDATE public.schools
SET
  name = COALESCE(NULLIF(btrim(name), ''), slug),
  timezone = COALESCE(NULLIF(btrim(timezone), ''), 'UTC')
WHERE NULLIF(btrim(name), '') IS NULL
   OR NULLIF(btrim(timezone), '') IS NULL;

ALTER TABLE public.schools
  ALTER COLUMN name SET NOT NULL,
  ALTER COLUMN timezone SET NOT NULL;

ALTER TABLE public.schools
  DROP COLUMN IF EXISTS full_name,
  DROP COLUMN IF EXISTS semesters;

CREATE UNIQUE INDEX IF NOT EXISTS schools_canonical_name_key
  ON public.schools (name);

CREATE UNIQUE INDEX IF NOT EXISTS schools_recipient_id_key
  ON public.schools (recipient_id)
  WHERE recipient_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'schools_slug_check'
  ) THEN
    ALTER TABLE public.schools
      ADD CONSTRAINT schools_slug_check
      CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'schools_recipient_id_check'
  ) THEN
    ALTER TABLE public.schools
      ADD CONSTRAINT schools_recipient_id_check
      CHECK (recipient_id IS NULL OR recipient_id ~ '^[0-9]{1,32}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'schools_semester_dates_check'
  ) THEN
    ALTER TABLE public.schools
      ADD CONSTRAINT schools_semester_dates_check
      CHECK (
        (semester_start IS NULL AND semester_end IS NULL)
        OR (
          semester_start IS NOT NULL
          AND semester_end IS NOT NULL
          AND semester_start <= semester_end
        )
      );
  END IF;
END
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
