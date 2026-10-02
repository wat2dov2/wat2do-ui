BEGIN;

-- Contact details belong to moderation, not published content or ownership.
ALTER TABLE public.event_submissions ADD COLUMN IF NOT EXISTS submitted_by_email text;
ALTER TABLE public.position_submissions ADD COLUMN IF NOT EXISTS submitted_by_email text;
ALTER TABLE public.clubs ADD COLUMN IF NOT EXISTS submitted_by_email text;

UPDATE public.event_submissions s SET submitted_by_email = u.email
FROM public.users u WHERE s.user_id = u.id AND s.submitted_by_email IS NULL;
UPDATE public.position_submissions s SET submitted_by_email = u.email
FROM public.users u WHERE s.user_id = u.id AND s.submitted_by_email IS NULL;
UPDATE public.clubs c SET submitted_by_email = u.email
FROM public.users u WHERE c.created_by = u.id AND c.submitted_by_email IS NULL;

-- Existing RLS and grants deny direct anon/authenticated access to these tables.
COMMIT;
