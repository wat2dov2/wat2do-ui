-- Send the banner's call to action somewhere a signed-out visitor can read.
--
-- It pointed at /posters, which is the promoter's own dashboard and requires an
-- account. Everyone who followed the banner while signed out was bounced
-- straight to /login?returnTo=%2Fposters without ever seeing what was being
-- offered. /promote is the public page that explains the programme and is where
-- the invitation belongs; enrolling from there still lands on /posters.
--
-- Only the destination is corrected. The copy is edited live and is left alone.

UPDATE public.site_banner
SET cta_href = '/promote',
    updated_at = now()
WHERE id = 1
  AND cta_href = '/posters';
