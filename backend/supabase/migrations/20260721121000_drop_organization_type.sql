-- Drop the legacy `organization_type` columns.
--
-- Superseded by `association_affiliated` (20260721120000), which every reader
-- and writer now uses.  Apply only after that migration has been deployed and
-- the app rolled out, since this is not reversible without a restore.
--
-- `events.organization_type` was denormalized purely to render the affiliation
-- badge and was never filtered on, so its index goes with it.

BEGIN;

DROP INDEX IF EXISTS public.idx_events_club_type;
DROP INDEX IF EXISTS public.idx_events_organization_type;

ALTER TABLE public.events        DROP COLUMN IF EXISTS organization_type;
ALTER TABLE public.organizations DROP COLUMN IF EXISTS organization_type;

NOTIFY pgrst, 'reload schema';

COMMIT;
