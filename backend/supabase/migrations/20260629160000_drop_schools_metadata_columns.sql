-- Drop unused school metadata columns.
--
-- Timezone, aliases, and semester_ends live in core.constants.school_mappings.
-- schools.name (slug) and school_email_domains remain the DB contract.

BEGIN;

ALTER TABLE public.schools
  DROP COLUMN IF EXISTS timezone,
  DROP COLUMN IF EXISTS aliases,
  DROP COLUMN IF EXISTS semester_ends;

NOTIFY pgrst, 'reload schema';

COMMIT;
