-- Allow public event submissions while keeping admin moderation protected.

BEGIN;

ALTER TABLE public.event_submissions
  ALTER COLUMN user_id DROP NOT NULL;

NOTIFY pgrst, 'reload schema';

COMMIT;
