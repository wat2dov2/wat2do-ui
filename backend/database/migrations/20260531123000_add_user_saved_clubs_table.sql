-- Migration: add_user_saved_clubs_table
-- Created: 2026-05-31
--
-- Per-user saved/followed clubs table.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + pg_constraint-guarded FKs
-- + IF NOT EXISTS indexes.

BEGIN;

-- 1. Table -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_saved_clubs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    club_id integer NOT NULL,
    saved_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT user_saved_clubs_user_id_club_id_key
        UNIQUE (user_id, club_id)
);

-- 2. RLS ---------------------------------------------------------------
ALTER TABLE public.user_saved_clubs ENABLE ROW LEVEL SECURITY;

-- 3. Foreign keys ------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_user_saved_clubs_user_id'
    ) THEN
        ALTER TABLE public.user_saved_clubs
            ADD CONSTRAINT fk_user_saved_clubs_user_id
            FOREIGN KEY (user_id) REFERENCES public.users(id)
            ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_user_saved_clubs_club_id'
    ) THEN
        ALTER TABLE public.user_saved_clubs
            ADD CONSTRAINT fk_user_saved_clubs_club_id
            FOREIGN KEY (club_id) REFERENCES public.clubs(id)
            ON DELETE CASCADE;
    END IF;
END$$;

-- 4. Indexes -----------------------------------------------------------
CREATE INDEX IF NOT EXISTS ix_user_saved_clubs_user_id
    ON public.user_saved_clubs (user_id);

COMMIT;
