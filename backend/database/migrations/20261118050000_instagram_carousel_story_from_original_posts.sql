-- A published carousel's story is now shared by the Mac's emulator worker: each event's
-- original Instagram post goes to the account's story, in slide order, instead of the
-- carousel's own slides through the Graph API.

COMMENT ON COLUMN public.instagram_publish_batches.story_status IS
    'Whether the events'' original posts went to the account''s story: pending, posted (at least one shared) or failed; NULL for carousels published before stories.';
COMMENT ON COLUMN public.instagram_publish_batches.story_error IS
    'Why the story is incomplete, such as how many of the posts were shared.';
