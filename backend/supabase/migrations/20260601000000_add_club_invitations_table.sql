-- Migration: add_club_invitations_table
-- Created: 2026-06-01
--
-- Manages pending email-based invitations for student clubs.
--

BEGIN;

-- 1. Table -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.club_invitations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id integer NOT NULL,
    email text NOT NULL,
    token uuid UNIQUE NOT NULL DEFAULT gen_random_uuid(),
    invited_by uuid NOT NULL,
    status text NOT NULL DEFAULT 'pending' CONSTRAINT chk_club_invitations_status CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,

    CONSTRAINT club_invitations_club_id_email_key
        UNIQUE (club_id, email)
);

-- 2. RLS ---------------------------------------------------------------
ALTER TABLE public.club_invitations ENABLE ROW LEVEL SECURITY;

-- 3. Foreign keys ------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_club_invitations_club_id'
    ) THEN
        ALTER TABLE public.club_invitations
            ADD CONSTRAINT fk_club_invitations_club_id
            FOREIGN KEY (club_id) REFERENCES public.clubs(id)
            ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_club_invitations_invited_by'
    ) THEN
        ALTER TABLE public.club_invitations
            ADD CONSTRAINT fk_club_invitations_invited_by
            FOREIGN KEY (invited_by) REFERENCES public.users(id)
            ON DELETE CASCADE;
    END IF;
END$$;

-- 4. Indexes -----------------------------------------------------------
CREATE INDEX IF NOT EXISTS ix_club_invitations_club_id
    ON public.club_invitations (club_id);

CREATE INDEX IF NOT EXISTS ix_club_invitations_email
    ON public.club_invitations (email);

CREATE INDEX IF NOT EXISTS ix_club_invitations_token
    ON public.club_invitations (token);

COMMIT;
