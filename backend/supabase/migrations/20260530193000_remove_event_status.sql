-- Migration: remove_event_status
-- Created: 2026-05-30
--
-- Drops the `status` column from the `events` table, along with
-- any associated check constraints, indexes, and deprecated dependent views.

BEGIN;

-- Drop the compatibility view events_listing if it exists (along with any cascades)
DROP VIEW IF EXISTS public.events_listing CASCADE;

-- Drop the index on events(status) if it exists
DROP INDEX IF EXISTS public.idx_events_status;

-- Drop the check constraint on events.status if it exists
ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_status_check;

-- Drop status column from events table
ALTER TABLE public.events DROP COLUMN IF EXISTS status;

COMMIT;
