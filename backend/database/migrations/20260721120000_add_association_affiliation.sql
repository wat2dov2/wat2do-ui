-- Replace the free-text `organization_type` affiliation flag with a boolean.
--
-- `organization_type` held {WUSA, Independent, Other, Social}: a Waterloo-specific
-- string that conflated "which student association" with "affiliated at all".
-- Every school has ~1 association clubs can affiliate with, so affiliation is a
-- boolean scoped by the row's existing `school` slug. Which association a slug
-- maps to remains a frontend presentation concern.
--
-- `organization_type` is dropped in a follow-up migration once this has baked.
--
-- Idempotent: safe to re-run.

BEGIN;

-- 1. Organizations: authoritative affiliation flag ---------------------------

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS association_affiliated boolean NOT NULL DEFAULT false;

-- WUSA was the only association ever represented.  Everything else
-- (Independent / Other / Social / blank) means "not affiliated".
UPDATE public.organizations
   SET association_affiliated = true
 WHERE upper(trim(coalesce(organization_type, ''))) = 'WUSA'
   AND association_affiliated = false;

-- 2. Events: denormalized copy for feed rendering ----------------------------
-- Mirrors how `organization_type` was denormalized onto events purely so the
-- badge could render without joining organizations.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS association_affiliated boolean NOT NULL DEFAULT false;

UPDATE public.events
   SET association_affiliated = true
 WHERE upper(trim(coalesce(organization_type, ''))) = 'WUSA'
   AND association_affiliated = false;

-- Events whose organization has since changed affiliation: re-sync from the
-- owning organization where one is resolvable by name + school.
UPDATE public.events e
   SET association_affiliated = o.association_affiliated
  FROM public.organizations o
 WHERE e.organization = o.organization_name
   AND e.school IS NOT DISTINCT FROM o.school
   AND e.association_affiliated IS DISTINCT FROM o.association_affiliated;

CREATE INDEX IF NOT EXISTS idx_events_association_affiliated
    ON public.events(association_affiliated);

NOTIFY pgrst, 'reload schema';

COMMIT;
