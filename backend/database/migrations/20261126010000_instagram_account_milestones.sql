-- Where each school Instagram account stood at its last milestone check, so a
-- thank-you story goes out only when a check sees a milestone happen
-- (backend/services/instagram_publishing/milestones.py): the highest hundred followers
-- celebrated, the follower count seen, the most likes any of its posts has had, and
-- the milestones that check opened for the sitting to post.
-- The first time a sitting checks an account it only records where the account
-- stands, so a first run never posts a story for past milestones.

CREATE TABLE IF NOT EXISTS public.instagram_account_milestones (
    account_key varchar(100) PRIMARY KEY
        REFERENCES public.instagram_publishing_accounts (account_key) ON DELETE CASCADE,
    followers_celebrated integer NOT NULL CHECK (followers_celebrated >= 0),
    followers_seen integer NOT NULL CHECK (followers_seen >= 0),
    like_record integer NOT NULL CHECK (like_record >= 0),
    like_record_media_id varchar(64),
    celebrated_media_ids varchar(64)[] NOT NULL DEFAULT '{}',
    checked_at timestamptz NOT NULL,
    open_followers integer CHECK (open_followers > 0),
    open_media_id varchar(64)
);

COMMENT ON COLUMN public.instagram_account_milestones.followers_celebrated IS
    'The highest hundred followers celebrated (or passed before the first check).';
COMMENT ON COLUMN public.instagram_account_milestones.followers_seen IS
    'The follower count the last check saw; a hundred counts only when crossed after it.';
COMMENT ON COLUMN public.instagram_account_milestones.like_record IS
    'The most likes any of the account''s posts has had, as the daily stats read them.';
COMMENT ON COLUMN public.instagram_account_milestones.celebrated_media_ids IS
    'Posts whose like record got its story (or stood at the first check); never again.';
COMMENT ON COLUMN public.instagram_account_milestones.checked_at IS
    'The last check; a milestone seen over milestone_window_hours after it gets no story.';

COMMENT ON COLUMN public.instagram_account_milestones.open_followers IS
    'The hundred the last check saw the account reach, until its story is posted.';
COMMENT ON COLUMN public.instagram_account_milestones.open_media_id IS
    'The post the last check saw beat the like record, until its story is posted.';

ALTER TABLE public.instagram_account_milestones ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.instagram_account_milestones TO service_role;
