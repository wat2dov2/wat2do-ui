-- Add school column to public.clubs table and backfill/seed school-specific clubs.
--
-- Keep this idempotent so it is safe to run after the full migration history.

BEGIN;

ALTER TABLE public.clubs ADD COLUMN IF NOT EXISTS school varchar(255);

-- Update existing clubs to 'University of Waterloo'
UPDATE public.clubs SET school = 'University of Waterloo' WHERE school IS NULL;

-- Insert new school-specific clubs if they do not already exist
INSERT INTO public.clubs (club_name, categories, club_page, ig, discord, club_type, school)
SELECT 'U of T Computer Science Student Union', '["Political and Social Awareness", "Media, Publications and Web Development"]'::jsonb, 'https://cssu.ca', 'cssu_uoft', 'cssu_discord', 'Independent', 'University of Toronto'
WHERE NOT EXISTS (SELECT 1 FROM public.clubs WHERE club_name = 'U of T Computer Science Student Union');

INSERT INTO public.clubs (club_name, categories, club_page, ig, discord, club_type, school)
SELECT 'U of T Board Games Club', '["Games, Recreational and Social"]'::jsonb, 'https://uoftboardgames.ca', 'uoftboardgames', 'uoftboardgames', 'Independent', 'University of Toronto'
WHERE NOT EXISTS (SELECT 1 FROM public.clubs WHERE club_name = 'U of T Board Games Club');

INSERT INTO public.clubs (club_name, categories, club_page, ig, discord, club_type, school)
SELECT 'McGill Computer Science Undergraduate Society', '["Political and Social Awareness", "Media, Publications and Web Development"]'::jsonb, 'https://csusmcgill.ca', 'csus_mcgill', 'csus_mcgill', 'Independent', 'McGill University'
WHERE NOT EXISTS (SELECT 1 FROM public.clubs WHERE club_name = 'McGill Computer Science Undergraduate Society');

INSERT INTO public.clubs (club_name, categories, club_page, ig, discord, club_type, school)
SELECT 'McGill Board Games Club', '["Games, Recreational and Social"]'::jsonb, 'https://mcgillboardgames.ca', 'mcgillboardgames', 'mcgillboardgames', 'Independent', 'McGill University'
WHERE NOT EXISTS (SELECT 1 FROM public.clubs WHERE club_name = 'McGill Board Games Club');

INSERT INTO public.clubs (club_name, categories, club_page, ig, discord, club_type, school)
SELECT 'UBC Computer Science Student Society', '["Political and Social Awareness", "Media, Publications and Web Development"]'::jsonb, 'https://ubccsss.ca', 'ubccsss', 'ubccsss', 'Independent', 'University of British Columbia'
WHERE NOT EXISTS (SELECT 1 FROM public.clubs WHERE club_name = 'UBC Computer Science Student Society');

INSERT INTO public.clubs (club_name, categories, club_page, ig, discord, club_type, school)
SELECT 'UBC Board Games Club', '["Games, Recreational and Social"]'::jsonb, 'https://ubcboardgames.ca', 'ubcboardgames', 'ubcboardgames', 'Independent', 'University of British Columbia'
WHERE NOT EXISTS (SELECT 1 FROM public.clubs WHERE club_name = 'UBC Board Games Club');

INSERT INTO public.clubs (club_name, categories, club_page, ig, discord, club_type, school)
SELECT 'McMaster Computer Science Society', '["Political and Social Awareness", "Media, Publications and Web Development"]'::jsonb, 'https://mcmastercss.ca', 'mcmastercss', 'mcmastercss', 'Independent', 'McMaster University'
WHERE NOT EXISTS (SELECT 1 FROM public.clubs WHERE club_name = 'McMaster Computer Science Society');

INSERT INTO public.clubs (club_name, categories, club_page, ig, discord, club_type, school)
SELECT 'McMaster Board Games Club', '["Games, Recreational and Social"]'::jsonb, 'https://mcmasterboardgames.ca', 'mcmasterboardgames', 'mcmasterboardgames', 'Independent', 'McMaster University'
WHERE NOT EXISTS (SELECT 1 FROM public.clubs WHERE club_name = 'McMaster Board Games Club');

NOTIFY pgrst, 'reload schema';

COMMIT;
