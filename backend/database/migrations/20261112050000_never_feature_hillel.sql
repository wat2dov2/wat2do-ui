BEGIN;

-- Wat2Do features no Hillel events. Every Hillel account (a club named or
-- handled Hillel, such as Hillel Waterloo, Hillel@York, Makom and Hillel UofT)
-- joins the clubs left out of carousels, so no carousel picks their events, and
-- an event of a club left out of carousels is never featured, even one a
-- carousel posted before. Deleting a row here lets that club be posted again.
INSERT INTO public.instagram_excluded_clubs (ig_handle, reason)
SELECT DISTINCT hillel.handle, 'Hillel: never featured or posted in carousels'
FROM (
    SELECT lower(ltrim(btrim(club.ig), '@')) AS handle
    FROM public.clubs AS club
    WHERE club.club_name ILIKE '%hillel%' OR club.ig ILIKE '%hillel%'
    UNION
    SELECT lower(ltrim(btrim(event.ig_handle), '@'))
    FROM public.events AS event
    WHERE event.club ILIKE '%hillel%' OR event.ig_handle ILIKE '%hillel%'
) AS hillel
WHERE hillel.handle <> ''
ON CONFLICT (ig_handle) DO NOTHING;

COMMIT;
