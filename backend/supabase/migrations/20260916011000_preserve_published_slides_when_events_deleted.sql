BEGIN;

-- Published slide images remain useful history after their source event is
-- deleted. Draft hydration omits these detached items; the next draft save
-- replaces its item set transactionally.
ALTER TABLE public.instagram_publish_items
    DROP CONSTRAINT instagram_publish_items_event_id_fkey,
    ALTER COLUMN event_id DROP NOT NULL;

ALTER TABLE public.instagram_publish_items
    ADD CONSTRAINT instagram_publish_items_event_id_fkey
    FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE SET NULL;

COMMIT;
