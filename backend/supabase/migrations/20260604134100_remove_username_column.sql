-- Remove username unique constraint and column from the public.users table
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_username_key CASCADE;
ALTER TABLE public.users DROP COLUMN IF EXISTS username CASCADE;
