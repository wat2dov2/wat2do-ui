BEGIN;

-- Keep the event category constraint aligned with the shared application taxonomy.
ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS chk_events_category_valid;

ALTER TABLE public.events
  ADD CONSTRAINT chk_events_category_valid
  CHECK (
    category IS NULL
    OR category IN (
      'Arts & Culture',
      'Academics & Science',
      'Business',
      'Community Service',
      'Environment',
      'Games & Recreation',
      'Health',
      'Media & Web',
      'Politics & Advocacy',
      'Religion & Spirituality'
    )
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
