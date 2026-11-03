-- Verified accounts may select their school after signing up on the root site.
ALTER TABLE public.users ALTER COLUMN school_id DROP NOT NULL;
