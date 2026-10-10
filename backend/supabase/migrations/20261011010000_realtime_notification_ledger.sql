BEGIN;

-- The Mac's browser worker listens for new ledger rows through Supabase
-- Realtime instead of polling, so a notified post is opened immediately.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
            AND schemaname = 'public'
            AND tablename = 'instagram_notification_media'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.instagram_notification_media;
    END IF;
END
$$;

COMMIT;
