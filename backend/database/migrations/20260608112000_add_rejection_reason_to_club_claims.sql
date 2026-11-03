-- Migration: add_rejection_reason_to_club_claims
-- Created: 2026-06-08

BEGIN;

ALTER TABLE public.club_claims 
    ADD COLUMN IF NOT EXISTS rejection_reason varchar(500);

COMMIT;
