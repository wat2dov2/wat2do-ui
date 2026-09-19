BEGIN;

-- Directory imports used the publisher's acronym while the club directory uses
-- its full name. Restore the same ownership used by Instagram reconciliation.
UPDATE public.events AS event
SET club_id = club.id,
    club = club.club_name,
    ig_handle = club.ig
FROM public.clubs AS club
JOIN public.schools AS school ON school.id = club.school_id
WHERE school.slug = 'uwaterloo'
  AND club.ig = 'yourwusa'
  AND club.club_name = 'Waterloo Undergraduate Student Association'
  AND event.school_id = school.id
  AND event.club_id IS NULL
  AND event.club = 'WUSA'
  AND event.source_url ~ '^https://(www\.)?wusa\.ca/event/';

COMMIT;
