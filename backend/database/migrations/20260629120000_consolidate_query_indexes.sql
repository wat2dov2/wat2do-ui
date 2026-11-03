-- Migration: add_organizations_school_name_index
-- Created: 2026-06-29
--
-- Organizations browse/search list: filter by school, order by organization_name.
-- Replaces unused manual single-column indexes on prod.

BEGIN;

CREATE INDEX IF NOT EXISTS ix_organizations_school_name
    ON public.organizations (school, organization_name);

DROP INDEX IF EXISTS public.organizations_school_idx;
DROP INDEX IF EXISTS public.organizations_organization_name_idx;

COMMIT;
