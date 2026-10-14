BEGIN;

-- Instagram numeric recipient IDs for notification routing and browser session matching.
UPDATE public.schools SET recipient_id = '25233164484' WHERE slug = 'uqam';
UPDATE public.schools SET recipient_id = '35231733553' WHERE slug = 'columbia';

COMMIT;
