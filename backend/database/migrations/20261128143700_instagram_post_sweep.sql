-- The logged-out post sweep (rust/src/ingestion/post_sweep.rs): every account a school
-- follows has its public profile read on a schedule set by how recently it posts, and
-- each read's posts since the one before join public.ingestion_items.
-- One row per handle read (a handle several schools follow is read once): when it was
-- last read, the newest post that read saw, when it is due again and how the read went.
-- A handle with no row has never been read and goes first.

CREATE TABLE IF NOT EXISTS public.instagram_post_sweep (
    handle varchar(30) PRIMARY KEY,
    read_at timestamptz,
    newest_post_at timestamptz,
    due_at timestamptz NOT NULL,
    outcome varchar(20) NOT NULL
        CHECK (outcome IN ('read', 'no_profile', 'not_rendered'))
);

CREATE INDEX IF NOT EXISTS instagram_post_sweep_due_at_idx
    ON public.instagram_post_sweep (due_at);

COMMENT ON COLUMN public.instagram_post_sweep.read_at IS
    'The last read whose page rendered; null until one has.';
COMMENT ON COLUMN public.instagram_post_sweep.newest_post_at IS
    'The newest post a read saw in the grid; sets how often the handle is read.';
COMMENT ON COLUMN public.instagram_post_sweep.due_at IS
    'When the handle is read next (controlbox/ingestion.json post_sweep_schedule).';
COMMENT ON COLUMN public.instagram_post_sweep.outcome IS
    'The last read: read (the profile rendered), no_profile (none shown logged out) or not_rendered.';

ALTER TABLE public.instagram_post_sweep ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.instagram_post_sweep TO service_role;
