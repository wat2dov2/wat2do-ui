BEGIN;

-- Second step after ingestion_items shipped: nothing reads these any more.
-- The Mac no longer claims, settles or redelivers ledger rows.
DROP FUNCTION IF EXISTS public.claim_next_instagram_notification_media;
DROP FUNCTION IF EXISTS public.claim_next_pending_instagram_media;
DROP FUNCTION IF EXISTS public.finalize_instagram_notification_media;
DROP FUNCTION IF EXISTS public.rollback_instagram_notification_media;
DROP FUNCTION IF EXISTS public.retry_failed_instagram_notification_media;
ALTER TABLE public.instagram_notification_media DROP COLUMN IF EXISTS browser_delivery_generation;

-- Directory agents read each listing themselves; the parser settings are gone.
ALTER TABLE public.directory_sources
    DROP COLUMN IF EXISTS source_format,
    DROP COLUMN IF EXISTS event_url_patterns,
    DROP COLUMN IF EXISTS event_url_exclude_patterns,
    DROP COLUMN IF EXISTS json_url_fields,
    DROP COLUMN IF EXISTS next_page_selector,
    DROP COLUMN IF EXISTS content_selector,
    DROP COLUMN IF EXISTS image_selector;

COMMIT;
