-- Each account's bio and profile link as the daily snapshot read them, so the
-- admin's social dashboard shows what every school account says about itself
-- and a missing bio or a wrong link stands out.
-- Null for snapshots taken before these were read, and when the account has none.

ALTER TABLE public.instagram_account_snapshots
    ADD COLUMN IF NOT EXISTS biography text,
    ADD COLUMN IF NOT EXISTS website text;

COMMENT ON COLUMN public.instagram_account_snapshots.biography IS
    'The account''s bio as the Graph API returned it that day.';
COMMENT ON COLUMN public.instagram_account_snapshots.website IS
    'The account''s first profile link as the Graph API returned it that day.';
