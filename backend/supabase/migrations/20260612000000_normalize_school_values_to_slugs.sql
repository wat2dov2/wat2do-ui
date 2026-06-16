-- Normalize canonical school values to URL/host slugs.
--
-- App school selection now comes from host labels such as `mit.wat2do.io`,
-- so the stored school values must be the same slug contract the API filters on.

BEGIN;

WITH school_map(old_name, slug, tz, aliases) AS (
  VALUES
    ('University of Waterloo',                'uwaterloo', 'America/Toronto', ARRAY['University of Waterloo', 'uw', 'u of w', 'waterloo']),
    ('University of Toronto - St. George',    'utoronto',  NULL,              ARRAY['University of Toronto - St. George', 'University of Toronto', 'u of t', 'uoft']),
    ('University of Toronto - Scarborough',   'utsc',      NULL,              ARRAY['University of Toronto - Scarborough']),
    ('McGill University',                     'mcgill',    NULL,              ARRAY['McGill University']),
    ('McMaster University',                   'mcmaster',  NULL,              ARRAY['McMaster University', 'mac']),
    ('Western University',                    'western',   NULL,              ARRAY['Western University', 'uwo']),
    ('Queen''s University',                   'queens',    NULL,              ARRAY['Queen''s University', 'queensu']),
    ('Carleton University',                   'carleton',  NULL,              ARRAY['Carleton University']),
    ('Brock University',                      'brock',     NULL,              ARRAY['Brock University']),
    ('Wilfrid Laurier University',            'wlu',       NULL,              ARRAY['Wilfrid Laurier University', 'laurier']),
    ('York University',                       'york',      NULL,              ARRAY['York University', 'yorku']),
    ('Toronto Metropolitan University',       'tmu',       NULL,              ARRAY['Toronto Metropolitan University', 'TMU', 'Ryerson University']),
    ('University of Ottawa',                  'uottawa',   NULL,              ARRAY['University of Ottawa']),
    ('OCAD University',                       'ocad',      NULL,              ARRAY['OCAD University']),
    ('Cornell University',                    'cornell',   NULL,              ARRAY['Cornell University']),
    ('New York University',                   'nyu',       NULL,              ARRAY['New York University']),
    ('University of Pennsylvania',            'upenn',     NULL,              ARRAY['University of Pennsylvania']),
    ('Columbia University',                   'columbia',  NULL,              ARRAY['Columbia University']),
    ('Massachusetts Institute of Technology', 'mit',       NULL,              ARRAY['Massachusetts Institute of Technology', 'MIT']),
    ('University of British Columbia',        'ubc',       NULL,              ARRAY['University of British Columbia'])
)
UPDATE public.events e
SET school = m.slug
FROM school_map m
WHERE e.school = m.old_name;

WITH school_map(old_name, slug) AS (
  VALUES
    ('University of Waterloo',                'uwaterloo'),
    ('University of Toronto - St. George',    'utoronto'),
    ('University of Toronto - Scarborough',   'utsc'),
    ('McGill University',                     'mcgill'),
    ('McMaster University',                   'mcmaster'),
    ('Western University',                    'western'),
    ('Queen''s University',                   'queens'),
    ('Carleton University',                   'carleton'),
    ('Brock University',                      'brock'),
    ('Wilfrid Laurier University',            'wlu'),
    ('York University',                       'york'),
    ('Toronto Metropolitan University',       'tmu'),
    ('University of Ottawa',                  'uottawa'),
    ('OCAD University',                       'ocad'),
    ('Cornell University',                    'cornell'),
    ('New York University',                   'nyu'),
    ('University of Pennsylvania',            'upenn'),
    ('Columbia University',                   'columbia'),
    ('Massachusetts Institute of Technology', 'mit'),
    ('University of British Columbia',        'ubc')
)
UPDATE public.organizations o
SET school = m.slug
FROM school_map m
WHERE o.school = m.old_name;

WITH school_map(old_name, slug) AS (
  VALUES
    ('University of Waterloo',                'uwaterloo'),
    ('University of Toronto - St. George',    'utoronto'),
    ('University of Toronto - Scarborough',   'utsc'),
    ('McGill University',                     'mcgill'),
    ('McMaster University',                   'mcmaster'),
    ('Western University',                    'western'),
    ('Queen''s University',                   'queens'),
    ('Carleton University',                   'carleton'),
    ('Brock University',                      'brock'),
    ('Wilfrid Laurier University',            'wlu'),
    ('York University',                       'york'),
    ('Toronto Metropolitan University',       'tmu'),
    ('University of Ottawa',                  'uottawa'),
    ('OCAD University',                       'ocad'),
    ('Cornell University',                    'cornell'),
    ('New York University',                   'nyu'),
    ('University of Pennsylvania',            'upenn'),
    ('Columbia University',                   'columbia'),
    ('Massachusetts Institute of Technology', 'mit'),
    ('University of British Columbia',        'ubc')
)
UPDATE public.users u
SET school = m.slug
FROM school_map m
WHERE u.school = m.old_name;

WITH school_map(old_name, slug, tz, aliases) AS (
  VALUES
    ('University of Waterloo',                'uwaterloo', 'America/Toronto', ARRAY['University of Waterloo', 'uw', 'u of w', 'waterloo']),
    ('University of Toronto - St. George',    'utoronto',  NULL,              ARRAY['University of Toronto - St. George', 'University of Toronto', 'u of t', 'uoft']),
    ('University of Toronto - Scarborough',   'utsc',      NULL,              ARRAY['University of Toronto - Scarborough']),
    ('McGill University',                     'mcgill',    NULL,              ARRAY['McGill University']),
    ('McMaster University',                   'mcmaster',  NULL,              ARRAY['McMaster University', 'mac']),
    ('Western University',                    'western',   NULL,              ARRAY['Western University', 'uwo']),
    ('Queen''s University',                   'queens',    NULL,              ARRAY['Queen''s University', 'queensu']),
    ('Carleton University',                   'carleton',  NULL,              ARRAY['Carleton University']),
    ('Brock University',                      'brock',     NULL,              ARRAY['Brock University']),
    ('Wilfrid Laurier University',            'wlu',       NULL,              ARRAY['Wilfrid Laurier University', 'laurier']),
    ('York University',                       'york',      NULL,              ARRAY['York University', 'yorku']),
    ('Toronto Metropolitan University',       'tmu',       NULL,              ARRAY['Toronto Metropolitan University', 'TMU', 'Ryerson University']),
    ('University of Ottawa',                  'uottawa',   NULL,              ARRAY['University of Ottawa']),
    ('OCAD University',                       'ocad',      NULL,              ARRAY['OCAD University']),
    ('Cornell University',                    'cornell',   NULL,              ARRAY['Cornell University']),
    ('New York University',                   'nyu',       NULL,              ARRAY['New York University']),
    ('University of Pennsylvania',            'upenn',     NULL,              ARRAY['University of Pennsylvania']),
    ('Columbia University',                   'columbia',  NULL,              ARRAY['Columbia University']),
    ('Massachusetts Institute of Technology', 'mit',       NULL,              ARRAY['Massachusetts Institute of Technology', 'MIT']),
    ('University of British Columbia',        'ubc',       NULL,              ARRAY['University of British Columbia'])
)
UPDATE public.schools s
SET
  name = m.slug,
  timezone = COALESCE(m.tz, s.timezone),
  aliases = m.aliases
FROM school_map m
WHERE s.name = m.old_name;

NOTIFY pgrst, 'reload schema';

COMMIT;
