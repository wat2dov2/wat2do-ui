BEGIN;

-- The Mac's ingestion processor LISTENs on the 'ingestion_items' channel and wakes
-- its lanes on every notification, so a notified post is fetched, and a ready row
-- processed, as soon as it appears. Plain LISTEN/NOTIFY works on any Postgres; it
-- replaces the Supabase Realtime subscription the processor used before.
--
-- The trigger is per row: a statement trigger also fires for an UPDATE that changes
-- nothing, which is every idle lane's claim_ingestion_item call, so each empty claim
-- would wake every lane into another. Postgres folds identical notifications in one
-- transaction into one, so a statement touching many rows still sends one.
CREATE OR REPLACE FUNCTION public.notify_ingestion_item_changes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    PERFORM pg_notify('ingestion_items', '');
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS notify_ingestion_item_changes ON public.ingestion_items;
CREATE TRIGGER notify_ingestion_item_changes
AFTER INSERT OR UPDATE ON public.ingestion_items
FOR EACH ROW
EXECUTE FUNCTION public.notify_ingestion_item_changes();

-- Nothing reads the queue through Realtime any more. The publication exists only on
-- Supabase.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
        AND EXISTS (
            SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime'
              AND schemaname = 'public'
              AND tablename = 'ingestion_items'
        )
    THEN
        ALTER PUBLICATION supabase_realtime DROP TABLE public.ingestion_items;
    END IF;
END;
$$;

COMMIT;
