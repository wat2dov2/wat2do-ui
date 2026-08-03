-- Align stored school colors with the shared logo contract: primary is the
-- background and secondary is the Wat2Do mark.

BEGIN;

WITH school_brand_colors(slug, primary_color, secondary_color) AS (
  VALUES
    ('carleton', '#E91C24', '#000000'),
    ('concordia', '#912338', '#CBB576'),
    ('dalhousie', '#242424', '#FFD400'),
    ('laval', '#E30513', '#FFC103'),
    ('memorial', '#862633', '#FFFFFF'),
    ('queens', '#002452', '#FABD0F'),
    ('sfu', '#CC0633', '#FFFFFF'),
    ('tmu', '#004C9B', '#FFDC00'),
    ('ualberta', '#275D38', '#FFDB05'),
    ('ucalgary', '#D6001C', '#FFCD00'),
    ('udem', '#0057AC', '#FFFFFF'),
    ('uottawa', '#8F001A', '#FFFFFF'),
    ('usask', '#0B6A41', '#F1C730'),
    ('utoronto', '#1E3765', '#FFFFFF'),
    ('utsc', '#1E3765', '#FFFFFF'),
    ('uwaterloo', '#000000', '#FED34C'),
    ('windsor', '#005596', '#FFCE00'),
    ('wlu', '#411884', '#FCC314')
)
UPDATE public.schools AS school
SET
  primary_color = colors.primary_color,
  secondary_color = colors.secondary_color
FROM school_brand_colors AS colors
WHERE school.slug = colors.slug;

COMMIT;
