BEGIN;

-- Instagram numeric recipient IDs for notification routing and browser session matching.
UPDATE public.schools SET recipient_id = '32776381224' WHERE slug = 'mit';
UPDATE public.schools SET recipient_id = '34983393418' WHERE slug = 'nyu';
UPDATE public.schools SET recipient_id = '35232934606' WHERE slug = 'upenn';
UPDATE public.schools SET recipient_id = '42319097867' WHERE slug = 'ontariotech';
UPDATE public.schools SET recipient_id = '35475106406' WHERE slug = 'cornell';

COMMIT;
