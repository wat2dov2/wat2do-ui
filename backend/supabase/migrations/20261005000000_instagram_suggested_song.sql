-- Keep the editorial music recommendation with its batch, independently of publication.
ALTER TABLE public.instagram_publish_batches
    ADD COLUMN suggested_song jsonb,
    ADD CONSTRAINT instagram_publish_batches_suggested_song_object
        CHECK (suggested_song IS NULL OR jsonb_typeof(suggested_song) = 'object');

COMMENT ON COLUMN public.instagram_publish_batches.suggested_song IS
    'Saved editorial song recommendation and chart provenance; not attached by the publishing API.';

NOTIFY pgrst, 'reload schema';
