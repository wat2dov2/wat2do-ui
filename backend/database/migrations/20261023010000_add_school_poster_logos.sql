-- Schools with enough scraped events show the wat2do logo built from their own
-- event posters. The weekly school logo job writes this URL, and clears it when a
-- school falls below the control box minimum so it shows the standard logo.

BEGIN;

ALTER TABLE public.schools
  ADD COLUMN poster_logo_url text;

ALTER TABLE public.schools
  ADD CONSTRAINT schools_poster_logo_url_check
  CHECK (
    poster_logo_url IS NULL
    OR poster_logo_url ~ '^https://'
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
