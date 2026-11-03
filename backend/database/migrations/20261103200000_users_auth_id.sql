-- users.auth_id replaces users.supabase_auth_id as the home of the JWT subject,
-- the same value auth_sessions.auth_id holds.
--
-- This is the first of two steps so a rolling deploy never breaks: while the
-- release before this one still reads and writes supabase_auth_id and this
-- release reads and writes auth_id, a trigger keeps the two columns equal
-- whichever one a writer sets. 20261103210000_drop_users_supabase_auth_id.sql
-- removes the trigger and the old column once no running release names it.

BEGIN;

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS auth_id varchar;

UPDATE public.users SET auth_id = supabase_auth_id WHERE auth_id IS DISTINCT FROM supabase_auth_id;

ALTER TABLE public.users ALTER COLUMN auth_id SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.users'::regclass AND conname = 'uq_users_auth_id'
    ) THEN
        ALTER TABLE public.users ADD CONSTRAINT uq_users_auth_id UNIQUE (auth_id);
    END IF;
END;
$$;

-- A writer that sets only one column gets the other filled in; a writer that
-- sets both to different values is refused. NOT NULL is checked after BEFORE
-- triggers run, so an insert naming either column alone satisfies both.
CREATE OR REPLACE FUNCTION public.sync_users_auth_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        NEW.auth_id := coalesce(NEW.auth_id, NEW.supabase_auth_id);
        NEW.supabase_auth_id := coalesce(NEW.supabase_auth_id, NEW.auth_id);
    ELSIF NEW.auth_id IS DISTINCT FROM OLD.auth_id
        AND NEW.supabase_auth_id IS NOT DISTINCT FROM OLD.supabase_auth_id
    THEN
        NEW.supabase_auth_id := NEW.auth_id;
    ELSIF NEW.supabase_auth_id IS DISTINCT FROM OLD.supabase_auth_id
        AND NEW.auth_id IS NOT DISTINCT FROM OLD.auth_id
    THEN
        NEW.auth_id := NEW.supabase_auth_id;
    END IF;
    IF NEW.auth_id IS DISTINCT FROM NEW.supabase_auth_id THEN
        RAISE EXCEPTION 'users.auth_id and users.supabase_auth_id must be equal';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_users_auth_id ON public.users;
CREATE TRIGGER sync_users_auth_id
BEFORE INSERT OR UPDATE ON public.users
FOR EACH ROW
EXECUTE FUNCTION public.sync_users_auth_id();

-- The data API learns about the new column.
NOTIFY pgrst, 'reload schema';

COMMIT;
