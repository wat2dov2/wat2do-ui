ALTER TABLE public.events ADD COLUMN IF NOT EXISTS source_video_url text;
ALTER TABLE public.positions ADD COLUMN IF NOT EXISTS source_video_url text;

COMMENT ON COLUMN public.events.source_video_url IS 'Persistent owned MP4 URL downloaded during Instagram ingestion; image URL remains the poster.';
COMMENT ON COLUMN public.positions.source_video_url IS 'Persistent owned MP4 URL downloaded during Instagram ingestion; image URL remains the poster.';
