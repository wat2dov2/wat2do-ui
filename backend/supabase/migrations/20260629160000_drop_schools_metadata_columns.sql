-- Drop unused school metadata columns.
--
-- This historical migration reduced schools to its slug and email-domain
-- contract. A later migration restores authoritative school metadata.

BEGIN;

ALTER TABLE public.schools
  DROP COLUMN IF EXISTS timezone,
  DROP COLUMN IF EXISTS aliases,
  DROP COLUMN IF EXISTS semester_ends;

NOTIFY pgrst, 'reload schema';

COMMIT;
