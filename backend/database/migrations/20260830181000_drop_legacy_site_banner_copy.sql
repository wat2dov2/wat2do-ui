-- Remove the English-only site-banner copy after the translation-key rollout.
--
-- Production commit e0813d9a reads only the replacement translation-key
-- columns, so these legacy columns no longer have a runtime consumer.

ALTER TABLE public.site_banner
    DROP COLUMN IF EXISTS message,
    DROP COLUMN IF EXISTS cta_label;
