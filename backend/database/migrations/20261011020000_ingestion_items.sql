BEGIN;

-- One row per Instagram post or official directory page: the only ingestion queue.
-- Instagram rows start at 'fetch' (the Mac's logged-out fetcher fills in the post);
-- directory rows arrive 'ready' with finished details from a directory agent.
-- Finished rows stay, so a URL is never queued twice.
CREATE TABLE IF NOT EXISTS public.ingestion_items (
    source_url varchar(2048) PRIMARY KEY CHECK (source_url ~ '^https://'),
    school_id integer NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    source text NOT NULL CHECK (source IN ('instagram', 'directory')),
    directory_source_id bigint REFERENCES public.directory_sources(id) ON DELETE SET NULL,
    status text NOT NULL DEFAULT 'fetch'
        CHECK (status IN ('fetch', 'ready', 'working', 'done', 'not_event', 'gone', 'failed')),
    post jsonb,
    attempts smallint NOT NULL DEFAULT 0,
    claimed_until timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ingestion_items_ready_post_check
        CHECK (status NOT IN ('ready', 'working') OR post IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ingestion_items_waiting_idx
    ON public.ingestion_items (status, created_at)
    WHERE status IN ('fetch', 'ready', 'working');
CREATE INDEX IF NOT EXISTS ingestion_items_directory_idx
    ON public.ingestion_items (directory_source_id) WHERE directory_source_id IS NOT NULL;

ALTER TABLE public.ingestion_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ingestion_items FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ingestion_items TO service_role;

-- Lease the oldest row waiting at one stage. A working row whose lease ran out
-- is claimable again, and a released row waits until its retry time.
CREATE OR REPLACE FUNCTION public.claim_ingestion_item(p_stage text, p_lease_seconds integer)
RETURNS SETOF public.ingestion_items
LANGUAGE sql
SET search_path = ''
AS $$
    UPDATE public.ingestion_items AS item
    SET status = CASE WHEN p_stage = 'ready' THEN 'working' ELSE 'fetch' END,
        claimed_until = now() + make_interval(secs => p_lease_seconds),
        attempts = item.attempts + 1,
        updated_at = now()
    WHERE item.source_url = (
        SELECT waiting.source_url
        FROM public.ingestion_items AS waiting
        WHERE (
            p_stage = 'fetch'
            AND waiting.status = 'fetch'
            AND (waiting.claimed_until IS NULL OR waiting.claimed_until < now())
        ) OR (
            p_stage = 'ready'
            AND (
                (waiting.status = 'ready'
                    AND (waiting.claimed_until IS NULL OR waiting.claimed_until < now()))
                OR (waiting.status = 'working' AND waiting.claimed_until < now())
            )
        )
        ORDER BY waiting.created_at, waiting.source_url
        FOR UPDATE SKIP LOCKED
        LIMIT 1
    )
    RETURNING item.*;
$$;
REVOKE ALL ON FUNCTION public.claim_ingestion_item(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_ingestion_item(text, integer) TO service_role;

-- Every notified post joins the queue the moment GitHub records it. The ledger
-- row is the notification's receipt; it no longer tracks capture progress.
CREATE OR REPLACE FUNCTION public.queue_notified_instagram_post()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.ingestion_items (source_url, school_id, source)
    SELECT
        'https://www.instagram.com/p/'
            || substring(NEW.source_url FROM '/(?:p|reel|tv)/([A-Za-z0-9_-]+)') || '/',
        notification.school_id,
        'instagram'
    FROM public.instagram_notifications AS notification
    WHERE notification.id = NEW.notification_id
    ON CONFLICT (source_url) DO NOTHING;
    NEW.status := 'succeeded';
    NEW.claim_token := coalesce(NEW.claim_token, gen_random_uuid());
    NEW.succeeded_at := coalesce(NEW.succeeded_at, now());
    NEW.failure_category := NULL;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS queue_notified_instagram_post ON public.instagram_notification_media;
CREATE TRIGGER queue_notified_instagram_post
BEFORE INSERT ON public.instagram_notification_media
FOR EACH ROW
EXECUTE FUNCTION public.queue_notified_instagram_post();

-- Posts the old Brave capture never finished move to the new queue.
INSERT INTO public.ingestion_items (source_url, school_id, source)
SELECT DISTINCT ON (waiting.url) waiting.url, notification.school_id, 'instagram'
FROM (
    SELECT
        'https://www.instagram.com/p/'
            || substring(media.source_url FROM '/(?:p|reel|tv)/([A-Za-z0-9_-]+)') || '/' AS url,
        media.notification_id,
        media.created_at
    FROM public.instagram_notification_media AS media
    WHERE media.status IN ('pending', 'processing', 'failed')
) AS waiting
JOIN public.instagram_notifications AS notification ON notification.id = waiting.notification_id
ORDER BY waiting.url, waiting.created_at
ON CONFLICT (source_url) DO NOTHING;
UPDATE public.instagram_notification_media
SET status = 'succeeded',
    claim_token = coalesce(claim_token, gen_random_uuid()),
    succeeded_at = now(),
    failure_category = NULL,
    updated_at = now()
WHERE status IN ('pending', 'processing', 'failed');

-- The processor and fetcher wake as soon as a row is added or becomes ready.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
        AND NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime'
              AND schemaname = 'public'
              AND tablename = 'ingestion_items'
        )
    THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.ingestion_items;
    END IF;
END;
$$;

COMMIT;
