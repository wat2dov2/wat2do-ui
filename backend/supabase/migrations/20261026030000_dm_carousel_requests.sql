BEGIN;

-- When a club asked us in our DMs to feature the event. Daily carousel drafts always
-- consider requested events, even ones added before the draft window, and rank them first.
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS carousel_requested_at timestamptz;
CREATE INDEX IF NOT EXISTS events_carousel_requested_idx
    ON public.events (school_id) WHERE carousel_requested_at IS NOT NULL;

-- A queued post a club asked us to feature: the ingestion agent marks the events it describes.
ALTER TABLE public.ingestion_items ADD COLUMN IF NOT EXISTS carousel_requested_at timestamptz;

-- 'dm' rows hold a club's DM about its listed events, for the agent to correct them.
ALTER TABLE public.ingestion_items DROP CONSTRAINT IF EXISTS ingestion_items_source_check;
ALTER TABLE public.ingestion_items ADD CONSTRAINT ingestion_items_source_check
    CHECK (source IN ('instagram', 'directory', 'dm'));

COMMIT;
