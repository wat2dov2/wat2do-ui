-- Move school brand colors into the authoritative school directory.

BEGIN;

ALTER TABLE public.schools
  ADD COLUMN primary_color varchar(7),
  ADD COLUMN secondary_color varchar(7);

WITH school_brand_colors(slug, primary_color, secondary_color) AS (
  VALUES
    ('uwaterloo', '#FFD54F', '#111111'),
    ('utoronto', '#002A5C', '#FFFFFF'),
    ('utsc', '#00A189', '#0B231E'),
    ('utm', '#0F4D92', '#FFFFFF'),
    ('mcgill', '#ED1B2F', '#FFFFFF'),
    ('mcmaster', '#7A003C', '#FDBF57'),
    ('western', '#4F2683', '#FFFFFF'),
    ('queens', '#B90E31', '#FFFFFF'),
    ('carleton', '#C8102E', '#FFFFFF'),
    ('brock', '#CC0000', '#FFFFFF'),
    ('wlu', '#4B2E39', '#FFC72C'),
    ('york', '#E31837', '#FFFFFF'),
    ('tmu', '#004C9B', '#FFFFFF'),
    ('uottawa', '#8A1538', '#FFFFFF'),
    ('ocad', '#000000', '#FFFFFF'),
    ('ualberta', '#007C41', '#FFDB05'),
    ('laval', '#DA291C', '#FFFFFF'),
    ('memorial', '#8C2332', '#FFFFFF'),
    ('sfu', '#A6192E', '#FFFFFF'),
    ('udem', '#0057B8', '#FFFFFF'),
    ('umanitoba', '#7A003C', '#FFFFFF'),
    ('concordia', '#912338', '#FFFFFF'),
    ('dalhousie', '#000000', '#FFCC00'),
    ('guelph', '#C20430', '#FFFFFF'),
    ('ucalgary', '#D6001C', '#FFFFFF'),
    ('usask', '#006F3C', '#FFFFFF'),
    ('uvic', '#005493', '#F5AA1C'),
    ('windsor', '#0057B7', '#FFFFFF'),
    ('uqam', '#009A44', '#FFFFFF'),
    ('ontariotech', '#003C71', '#FFFFFF'),
    ('cornell', '#B31B1B', '#FFFFFF'),
    ('nyu', '#57068C', '#FFFFFF'),
    ('upenn', '#011F5B', '#FFFFFF'),
    ('columbia', '#B9D9EB', '#0B2B3C'),
    ('mit', '#A31F34', '#FFFFFF'),
    ('ubc', '#002145', '#FFFFFF'),
    ('berkeley', '#003262', '#FDB515')
)
UPDATE public.schools AS school
SET
  primary_color = colors.primary_color,
  secondary_color = colors.secondary_color
FROM school_brand_colors AS colors
WHERE school.slug = colors.slug;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.schools
    WHERE primary_color IS NULL
       OR secondary_color IS NULL
  ) THEN
    RAISE EXCEPTION 'Every school must have primary and secondary brand colors';
  END IF;
END
$$;

ALTER TABLE public.schools
  ALTER COLUMN primary_color SET NOT NULL,
  ALTER COLUMN secondary_color SET NOT NULL,
  ADD CONSTRAINT schools_primary_color_check
    CHECK (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  ADD CONSTRAINT schools_secondary_color_check
    CHECK (secondary_color ~ '^#[0-9A-Fa-f]{6}$');

NOTIFY pgrst, 'reload schema';

COMMIT;
