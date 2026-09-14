-- Recovered from a read-only production comparison on 2026-09-11.
-- A separate database rebuilt from main matched production's public schema
-- except for schools.faculties and physical column order.
-- Production records 20260906190000, 20260907180000, and 20260907181000,
-- but all three ledger entries have NULL name and statements.
-- Their exact original SQL, ordering, and any historical data edits are unknown.
-- This final version reconstructs the observed combined schema delta and the
-- current nonempty faculty reference data, not the lost original statements.
-- Production has already applied this version, so normal db push skips this file.
-- Do not revert or delete production ledger entries to replay these statements.

ALTER TABLE public.schools
    ADD COLUMN faculties text[] DEFAULT '{}'::text[] NOT NULL;

UPDATE public.schools SET faculties = '{"Applied Health Sciences","Goodman School of Business",Education,Humanities,"Mathematics and Science","Social Sciences"}'::text[] WHERE slug = 'brock';
UPDATE public.schools SET faculties = '{"Arts and Social Sciences","Engineering and Design","Public Affairs",Science,"Sprott School of Business"}'::text[] WHERE slug = 'carleton';
UPDATE public.schools SET faculties = '{"Agricultural and Environmental Sciences",Arts,"Dental Medicine and Oral Health Sciences",Education,Engineering,Law,Management,"Medicine and Health Sciences",Music,Science}'::text[] WHERE slug = 'mcgill';
UPDATE public.schools SET faculties = '{Business,Engineering,"Health Sciences",Humanities,Science,"Social Sciences"}'::text[] WHERE slug = 'mcmaster';
UPDATE public.schools SET faculties = '{"Architecture and Planning",Engineering,"Humanities, Arts, and Social Sciences","Sloan School of Management",Science,"Schwarzman College of Computing"}'::text[] WHERE slug = 'mit';
UPDATE public.schools SET faculties = '{"Business and Information Technology",Education,"Engineering and Applied Science","Health Sciences",Science,"Social Science and Humanities"}'::text[] WHERE slug = 'ontariotech';
UPDATE public.schools SET faculties = '{"Applied Sciences","Arts and Social Sciences","Beedie School of Business","Communication, Art and Technology",Education,Environment,"Health Sciences",Science}'::text[] WHERE slug = 'sfu';
UPDATE public.schools SET faculties = '{Arts,"Community Services","Engineering and Architectural Science","Ted Rogers School of Management",Science,"Creative School"}'::text[] WHERE slug = 'tmu';
UPDATE public.schools SET faculties = '{Aménagement,"Arts et sciences",Droit,Médecine,Musique,"Sciences de l''éducation","Sciences infirmières","Santé publique","Médecine vétérinaire"}'::text[] WHERE slug = 'udem';
UPDATE public.schools SET faculties = '{"Agricultural and Food Sciences",Architecture,Art,Arts,"Asper School of Business",Education,"Price Faculty of Engineering","Environment, Earth, and Resources","Health Sciences","Kinesiology and Recreation Management",Law,Music,Science,"Social Work"}'::text[] WHERE slug = 'umanitoba';
UPDATE public.schools SET faculties = '{"Arts and Sciences","Engineering and Applied Science","Wharton School",Nursing,Law,Medicine,"Dental Medicine",Design,Education,"Social Policy & Practice","Veterinary Medicine"}'::text[] WHERE slug = 'upenn';
UPDATE public.schools SET faculties = '{Arts,Communication,"Science politique et droit",Sciences,"Sciences de l''éducation","Sciences humaines","École des sciences de la gestion"}'::text[] WHERE slug = 'uqam';
UPDATE public.schools SET faculties = '{"Communication, Culture, Information & Technology",Humanities,Management,Sciences,"Social Sciences"}'::text[] WHERE slug = 'utm';
UPDATE public.schools SET faculties = '{"Arts & Science",Management,"Computer Science",Humanities,"Social Sciences"}'::text[] WHERE slug = 'utsc';
UPDATE public.schools SET faculties = '{"Applied Health Sciences",Arts,Engineering,Environment,Health,Mathematics,Science}'::text[] WHERE slug = 'uwaterloo';
UPDATE public.schools SET faculties = '{Arts,"Lazaridis School of Business and Economics",Education,"Human and Social Sciences","Liberal Arts",Music,Science}'::text[] WHERE slug = 'wlu';
