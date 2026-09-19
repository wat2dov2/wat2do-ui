BEGIN;

UPDATE public.schools SET language = 'fr' WHERE slug = 'mun';

-- Existing editable batches carry the generated intro from their creation date.
-- Preserve custom copy and published history; detail hydration rebuilds the caption.
UPDATE public.instagram_publish_batches
SET caption_intro = 'Nouveaux événements à mun, ajoutés à Wat2Do dans les dernières 24 heures 👀',
    version = version + 1,
    updated_at = now()
WHERE school_id = (SELECT id FROM public.schools WHERE slug = 'mun')
  AND status IN ('ready_for_review', 'failed')
  AND caption_intro = 'Fresh events at mun, added to Wat2Do in the last 24 hours 👀';

COMMIT;
