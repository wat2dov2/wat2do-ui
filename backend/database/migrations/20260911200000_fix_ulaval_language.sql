BEGIN;

-- The canonical slug is ulaval; the original language migration targeted laval.
UPDATE public.schools SET language = 'fr' WHERE slug = 'ulaval';

COMMIT;
