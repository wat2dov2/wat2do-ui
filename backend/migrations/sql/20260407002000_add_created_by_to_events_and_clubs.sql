-- Migration: add_created_by_to_events_and_clubs
-- Created: 2026-04-07T00:20:00+00:00
--
-- Add created_by column to events and clubs tables for ownership tracking.
-- Stores the Supabase auth UID of the user who created the resource.
-- Nullable because existing rows predate ownership tracking; NULL rows
-- are only modifiable by admins.

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS created_by TEXT;

ALTER TABLE clubs
  ADD COLUMN IF NOT EXISTS created_by TEXT;

CREATE INDEX IF NOT EXISTS idx_events_created_by ON events (created_by);
CREATE INDEX IF NOT EXISTS idx_clubs_created_by ON clubs (created_by);
