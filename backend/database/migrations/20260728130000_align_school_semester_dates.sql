-- Use one shared semester window for every school.

BEGIN;

UPDATE public.schools
SET
  semester_start = '2026-05-01',
  semester_end = '2026-08-31';

NOTIFY pgrst, 'reload schema';

COMMIT;
