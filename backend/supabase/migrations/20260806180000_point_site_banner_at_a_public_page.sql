-- Send the banner's call to action somewhere a signed-out visitor can read,
-- and say plainly what it is asking for.
--
-- It pointed at /posters, which is the promoter's own dashboard and requires an
-- account. Everyone who followed the banner while signed out was bounced
-- straight to /login?returnTo=%2Fposters without ever seeing what was being
-- offered. /promote is the public page that explains the programme and is where
-- the invitation belongs; enrolling from there still lands on /posters.
--
-- The message is set here rather than left to a live edit so the checked-in
-- default and production agree. It is written without {{school}} on purpose:
-- "your campus" reads the same on every subdomain.

UPDATE public.site_banner
SET message = 'Help us grow Wat2Do at your campus!',
    cta_label = 'Learn more',
    cta_href = '/promote',
    updated_at = now()
WHERE id = 1;
