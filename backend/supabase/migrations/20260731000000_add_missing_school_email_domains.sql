-- Give the 15 domainless schools their student email domains.
--
-- These schools were added to public.schools without any row in
-- school_email_domains, so core.allowed_emails had nothing to match and every
-- one of their students was rejected at sign-up.
--
-- Domains are the addresses currently enrolled students actually receive, taken
-- from each university's own IT documentation. Several are deliberately NOT the
-- apex domain, because the apex belongs to staff and would admit non-students:
--   umanitoba   students are @myumanitoba.ca; umanitoba.ca is staff
--   uqam        students are @courrier.uqam.ca; uqam.ca is staff
--   concordia   students are @live.concordia.ca; concordia.ca is staff
--   ontariotech students are @ontariotechu.net; the .ca domains are staff
--   usask       every student has @mail.usask.ca, while @usask.ca is only an
--               optional self-created alias, so the subdomain is primary here
--
-- Keyed on slug rather than name because school names have been renormalised
-- since the original seed. domain is globally UNIQUE, so ON CONFLICT keeps this
-- re-runnable.
--
-- University of Toronto Mississauga is deliberately absent: its students use the
-- central @mail.utoronto.ca, which already belongs to the St. George record, and
-- a domain cannot map to two schools.

INSERT INTO public.school_email_domains (school_id, domain, is_primary)
SELECT s.id, d.domain, d.is_primary
FROM (VALUES
  ('ualberta',    'ualberta.ca',        true),
  ('ulaval',      'ulaval.ca',          true),
  ('mun',         'mun.ca',             true),
  ('sfu',         'sfu.ca',             true),
  ('udem',        'umontreal.ca',       true),
  ('umanitoba',   'myumanitoba.ca',     true),
  ('concordia',   'live.concordia.ca',  true),
  ('concordia',   'mail.concordia.ca',  false),
  ('dalhousie',   'dal.ca',             true),
  ('guelph',      'uoguelph.ca',        true),
  ('ucalgary',    'ucalgary.ca',        true),
  ('usask',       'mail.usask.ca',      true),
  ('usask',       'usask.ca',           false),
  ('uvic',        'uvic.ca',            true),
  ('uwindsor',    'uwindsor.ca',        true),
  ('uqam',        'courrier.uqam.ca',   true),
  ('ontariotech', 'ontariotechu.net',   true),
  ('ontariotech', 'uoit.net',           false)
) AS d(slug, domain, is_primary)
JOIN public.schools s ON s.slug = d.slug
ON CONFLICT (domain) DO NOTHING;
