-- Restore the canonical school slug for legacy user profiles.
--
-- New accounts already resolve their school through school_email_domains.
-- Older profiles may still have NULL, blank, or pre-slug display-name values,
-- which prevents timezone resolution and school-scoped morning-email picks.

BEGIN;

UPDATE public.users AS app_user
SET school = school.name
FROM public.school_email_domains AS email_domain
JOIN public.schools AS school
  ON school.id = email_domain.school_id
WHERE lower(split_part(btrim(app_user.email), '@', 2)) = lower(email_domain.domain)
  AND (
    NULLIF(btrim(app_user.school), '') IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM public.schools AS current_school
      WHERE current_school.name = lower(btrim(app_user.school))
    )
  )
  AND app_user.school IS DISTINCT FROM school.name;

COMMIT;
