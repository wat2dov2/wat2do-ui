-- Allow public event reports while keeping admin moderation protected.

BEGIN;

ALTER TABLE public.reported_events
  ALTER COLUMN user_id DROP NOT NULL;

NOTIFY pgrst, 'reload schema';

COMMIT;
