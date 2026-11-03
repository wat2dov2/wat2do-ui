-- Keep a school's city in its authoritative directory row, alongside its name.
-- Cities follow the main-campus location; this is not a visitor geolocation.
BEGIN;

ALTER TABLE public.schools
    ADD COLUMN IF NOT EXISTS city text;

COMMENT ON COLUMN public.schools.city IS
    'City associated with the school or campus, used for local community messaging.';

-- Campus-specific choices follow the institutions' published addresses:
-- https://www.utsc.utoronto.ca/home/contact-information (Toronto)
-- https://www.sfu.ca/campuses/burnaby.html (Burnaby)
-- https://www.ubc.ca/landing/campusservices.html (Vancouver)
UPDATE public.schools AS school
SET city = location.city
FROM (VALUES
    ('berkeley', 'Berkeley'),
    ('brocku', 'St. Catharines'),
    ('carleton', 'Ottawa'),
    ('columbia', 'New York'),
    ('concordia', 'Montréal'),
    ('cornell', 'Ithaca'),
    ('dalhousie', 'Halifax'),
    ('guelph', 'Guelph'),
    ('mcgill', 'Montréal'),
    ('mcmaster', 'Hamilton'),
    ('mit', 'Cambridge'),
    ('mun', 'St. John''s'),
    ('nyu', 'New York'),
    ('ocadu', 'Toronto'),
    ('ontariotech', 'Oshawa'),
    ('ottawa', 'Ottawa'),
    ('queensu', 'Kingston'),
    ('sfu', 'Burnaby'),
    ('tmu', 'Toronto'),
    ('ualberta', 'Edmonton'),
    ('ubc', 'Vancouver'),
    ('ucalgary', 'Calgary'),
    ('udem', 'Montréal'),
    ('ulaval', 'Québec City'),
    ('umanitoba', 'Winnipeg'),
    ('umich', 'Ann Arbor'),
    ('upenn', 'Philadelphia'),
    ('uqam', 'Montréal'),
    ('usask', 'Saskatoon'),
    ('utm', 'Mississauga'),
    ('utsc', 'Toronto'),
    ('utsg', 'Toronto'),
    ('uwaterloo', 'Waterloo'),
    ('uwindsor', 'Windsor'),
    ('uwo', 'London'),
    ('wlu', 'Waterloo'),
    ('yorku', 'Toronto')
) AS location(slug, city)
WHERE school.slug = location.slug
  AND school.city IS NULL;

-- The existing row continues to own visibility; preserve its enabled setting.
UPDATE public.site_banner
SET message_translation_key = 'siteBanner.businessSupport.message',
    cta_label_translation_key = 'siteBanner.businessSupport.cta',
    cta_href = '/support-local',
    updated_at = now()
WHERE id = 1;

NOTIFY pgrst, 'reload schema';

COMMIT;
