-- Review drafts exist before a school's Instagram account is connected.
ALTER TABLE public.instagram_publish_batches
    ALTER COLUMN instagram_user_id DROP NOT NULL;

COMMENT ON COLUMN public.instagram_publish_batches.instagram_user_id IS
    'Connected account identity, bound and validated before publishing; null for unconnected review drafts.';
COMMENT ON COLUMN public.instagram_publishing_accounts.enabled IS
    'Whether this connected account may publish; all registered schools receive review drafts.';

NOTIFY pgrst, 'reload schema';
