-- Migration: add_organization_approval
-- Created: 2026-07-24
--
-- Organizations created by non-admins now land in a review queue instead of
-- going live immediately. Existing rows default to 'approved' so the live
-- directory is unchanged by this migration.

BEGIN;

ALTER TABLE public.organizations
    ADD COLUMN IF NOT EXISTS status varchar(32) NOT NULL DEFAULT 'approved';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_organizations_status'
    ) THEN
        ALTER TABLE public.organizations
            ADD CONSTRAINT chk_organizations_status
            CHECK (status IN ('pending', 'approved', 'rejected'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_organizations_status ON public.organizations (status);

COMMIT;
