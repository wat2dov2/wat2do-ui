-- Move the publishing roster out of the control box and onto the account row.
--
-- The control box listed which accounts existed and whether each one ran, while
-- the row it pointed at already held that account's identity, token and school.
-- Whether an account publishes belongs beside those, so the connected row is the
-- only place an account is described.
--
-- Existing rows default to enabled: every one of them was listed as enabled in
-- the control box this replaces.

ALTER TABLE public.instagram_publishing_accounts
    ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.instagram_publishing_accounts.enabled IS
    'Whether the daily job generates and publishes batches for this account.';
