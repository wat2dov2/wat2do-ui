-- Add Berkeley to the slug-based school directory.

BEGIN;

INSERT INTO public.schools (name, timezone, aliases)
VALUES (
  'berkeley',
  'America/Los_Angeles',
  ARRAY['University of California, Berkeley', 'UC Berkeley', 'Berkeley']
)
ON CONFLICT (name) DO UPDATE
SET
  timezone = EXCLUDED.timezone,
  aliases = EXCLUDED.aliases;

INSERT INTO public.school_email_domains (school_id, domain, is_primary)
SELECT id, 'berkeley.edu', true
FROM public.schools
WHERE name = 'berkeley'
ON CONFLICT (domain) DO NOTHING;

UPDATE public.organizations
SET school = 'berkeley'
WHERE school = 'University of California, Berkeley';

NOTIFY pgrst, 'reload schema';

COMMIT;
