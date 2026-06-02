-- Migration: add_club_members_table
-- Created: 2026-05-31
--
-- Supported multiple club members/managers.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + pg_constraint-guarded FKs
-- + IF NOT EXISTS indexes + backfill from clubs.created_by.

BEGIN;

-- 1. Table -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.club_members (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id integer NOT NULL,
    user_id uuid NOT NULL,
    joined_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT club_members_club_id_user_id_key
        UNIQUE (club_id, user_id)
);

-- 2. RLS ---------------------------------------------------------------
ALTER TABLE public.club_members ENABLE ROW LEVEL SECURITY;

-- 3. Foreign keys ------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_club_members_club_id'
    ) THEN
        ALTER TABLE public.club_members
            ADD CONSTRAINT fk_club_members_club_id
            FOREIGN KEY (club_id) REFERENCES public.clubs(id)
            ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_club_members_user_id'
    ) THEN
        ALTER TABLE public.club_members
            ADD CONSTRAINT fk_club_members_user_id
            FOREIGN KEY (user_id) REFERENCES public.users(id)
            ON DELETE CASCADE;
    END IF;
END$$;

-- 4. Indexes -----------------------------------------------------------
CREATE INDEX IF NOT EXISTS ix_club_members_club_id
    ON public.club_members (club_id);

CREATE INDEX IF NOT EXISTS ix_club_members_user_id
    ON public.club_members (user_id);

-- 5. Backfill ----------------------------------------------------------
-- Insert a member row for every existing club's owner (created_by user)
INSERT INTO public.club_members (club_id, user_id)
SELECT id, created_by
FROM public.clubs
WHERE created_by IS NOT NULL
ON CONFLICT (club_id, user_id) DO NOTHING;

COMMIT;
