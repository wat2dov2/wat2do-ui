BEGIN;

ALTER TABLE public.schools
    ADD COLUMN language text NOT NULL DEFAULT 'en'
    CHECK (language IN ('en', 'fr'));

UPDATE public.schools SET language = 'fr' WHERE slug IN ('uqam', 'udem', 'laval');
UPDATE public.schools SET primary_color = '#0057AC' WHERE slug = 'uqam';
-- School relationships use immutable school_id, so the canonical slug changes once.
UPDATE public.schools SET slug = 'brocku' WHERE slug = 'brock';

COMMIT;
