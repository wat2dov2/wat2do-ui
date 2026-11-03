-- Set the banner's message.
--
-- This belongs in 20260806180000, which is where it was written - but that
-- migration had already been applied when the message was added to it, so the
-- amended body never ran and only its original line, the cta_href, took effect.
-- An applied migration is a record of what happened, not a file to edit, so the
-- part that never ran gets its own migration rather than a second attempt at
-- rewriting history.
--
-- Written without {{school}} on purpose: "your campus" reads the same on every
-- subdomain.

UPDATE public.site_banner
SET message = 'Help us grow Wat2Do at your campus!',
    cta_label = 'Learn more',
    updated_at = now()
WHERE id = 1;
