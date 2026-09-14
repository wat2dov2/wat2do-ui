ALTER TABLE public.schools
    ADD COLUMN IF NOT EXISTS location_examples text[] NOT NULL DEFAULT '{}';

UPDATE public.schools
SET location_examples = examples.locations
FROM (VALUES
    ('uwaterloo', ARRAY['MC', 'SLC']::text[]),
    ('ualberta', ARRAY['Students Union Building', 'Cameron Library']::text[]),
    ('ulaval', ARRAY['Pavillon Alphonse-Desjardins', 'PEPS']::text[])
) AS examples(slug, locations)
WHERE schools.slug = examples.slug;
