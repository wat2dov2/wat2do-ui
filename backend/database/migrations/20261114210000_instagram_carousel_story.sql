-- Each published carousel's slides also go to the account's story, as 9:16
-- frames in slide order, right after the carousel posts.
-- The batch records how that went beside the carousel itself, which stays
-- published whatever happens to its story.

ALTER TABLE public.instagram_publish_batches
    ADD COLUMN IF NOT EXISTS story_status text,
    ADD COLUMN IF NOT EXISTS story_error text;

ALTER TABLE public.instagram_publish_batches
    DROP CONSTRAINT IF EXISTS instagram_publish_batches_story_status_check;
ALTER TABLE public.instagram_publish_batches
    ADD CONSTRAINT instagram_publish_batches_story_status_check
    CHECK (story_status IS NULL OR story_status IN ('pending', 'posted', 'failed'));

COMMENT ON COLUMN public.instagram_publish_batches.story_status IS
    'Whether the carousel''s slides went to the account''s story: pending, posted or failed; NULL for carousels published before stories were posted.';
COMMENT ON COLUMN public.instagram_publish_batches.story_error IS
    'Why the story was not posted, including how many slides went up first.';
