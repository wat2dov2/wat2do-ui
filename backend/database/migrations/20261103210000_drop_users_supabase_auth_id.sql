-- The second step of 20261103200000_users_auth_id.sql: every running release
-- now reads and writes users.auth_id, so the sync trigger and the old
-- supabase_auth_id column go.
--
-- Row-level security policies from before our own auth compared
-- users.supabase_auth_id with auth.uid() for the authenticated role. No request
-- reaches a table as that role any more (the data API accepts only the
-- backend's service token, whose role bypasses row-level security), and the
-- column cannot be dropped while they name it, so they go too. Any other object
-- still depending on the column stops this migration instead of being dropped
-- with it.

BEGIN;

DROP TRIGGER IF EXISTS sync_users_auth_id ON public.users;
DROP FUNCTION IF EXISTS public.sync_users_auth_id();

DROP POLICY IF EXISTS select_own_claims ON public.club_claims;
DROP POLICY IF EXISTS insert_own_claims ON public.club_claims;
DROP POLICY IF EXISTS select_join_requests ON public.club_join_requests;
DROP POLICY IF EXISTS insert_own_join_requests ON public.club_join_requests;
DROP POLICY IF EXISTS "Enable read access for admins only" ON public.automate_logs;

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS uq_users_supabase_auth_id;
DROP INDEX IF EXISTS public.ix_users_supabase_auth_id;
ALTER TABLE public.users DROP COLUMN IF EXISTS supabase_auth_id;

-- The data API forgets the dropped column.
NOTIFY pgrst, 'reload schema';

COMMIT;
