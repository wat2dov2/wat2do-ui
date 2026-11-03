-- Migration: rename_saved_events_to_going_events
-- Created: 2026-07-10

BEGIN;

-- 1. Rename table
ALTER TABLE public.user_saved_events RENAME TO user_going_events;

-- 2. Rename column
ALTER TABLE public.user_going_events RENAME COLUMN saved_at TO going_at;

-- 3. Rename constraints
ALTER TABLE public.user_going_events
  RENAME CONSTRAINT user_saved_events_pkey TO user_going_events_pkey;
ALTER TABLE public.user_going_events
  RENAME CONSTRAINT user_saved_events_user_id_event_id_key TO user_going_events_user_id_event_id_key;
ALTER TABLE public.user_going_events
  RENAME CONSTRAINT fk_user_saved_events_event_id TO fk_user_going_events_event_id;
ALTER TABLE public.user_going_events
  RENAME CONSTRAINT fk_user_saved_events_user_id TO fk_user_going_events_user_id;

-- 4. Rename index
ALTER INDEX IF EXISTS ix_user_saved_events_user_id RENAME TO ix_user_going_events_user_id;

-- 5. Migrate analytics interaction types
UPDATE public.user_interactions
SET interaction_type = 'going'
WHERE interaction_type = 'save';

UPDATE public.user_interactions
SET interaction_type = 'ungoing'
WHERE interaction_type = 'unsave';

COMMIT;
