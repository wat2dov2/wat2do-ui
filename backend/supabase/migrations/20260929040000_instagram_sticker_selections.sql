-- Editorial choices belong to the draft, while live event facts remain on events.
ALTER TABLE public.instagram_publish_batches
    ADD COLUMN IF NOT EXISTS sticker_selections jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(sticker_selections) = 'object');
