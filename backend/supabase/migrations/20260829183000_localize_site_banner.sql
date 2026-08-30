-- Add stable i18n keys to the site-banner control row.
--
-- Banner copy is rendered by the frontend and changes with the visitor's
-- selected language. Keeping English literals in this table made that
-- impossible and created two potential owners for translated copy. The row
-- continues to control whether the banner is enabled and where its CTA leads;
-- locale files now own the message and label.
--
-- Keep the literal columns during this rollout because migrations run before
-- the new backend is deployed. The next migration can remove them after every
-- production task reads these translation-key columns.

ALTER TABLE public.site_banner
    ADD COLUMN IF NOT EXISTS message_translation_key text;

ALTER TABLE public.site_banner
    ADD COLUMN IF NOT EXISTS cta_label_translation_key text;

UPDATE public.site_banner
SET message_translation_key = 'siteBanner.founderStory.message',
    cta_label_translation_key = 'siteBanner.founderStory.cta',
    updated_at = now()
WHERE id = 1;

ALTER TABLE public.site_banner
    ALTER COLUMN message_translation_key SET NOT NULL,
    ALTER COLUMN cta_label_translation_key SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'site_banner_message_translation_key_not_blank'
    ) THEN
        ALTER TABLE public.site_banner
            ADD CONSTRAINT site_banner_message_translation_key_not_blank
            CHECK (length(btrim(message_translation_key)) > 0);
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'site_banner_cta_label_translation_key_not_blank'
    ) THEN
        ALTER TABLE public.site_banner
            ADD CONSTRAINT site_banner_cta_label_translation_key_not_blank
            CHECK (length(btrim(cta_label_translation_key)) > 0);
    END IF;
END
$$;

COMMENT ON COLUMN public.site_banner.message_translation_key IS
    'Frontend i18n key for the translated announcement copy.';

COMMENT ON COLUMN public.site_banner.cta_label_translation_key IS
    'Frontend i18n key for the translated call-to-action label.';
