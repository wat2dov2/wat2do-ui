-- Migration: add_club_memberships_table
-- Created: 2026-06-05
--
-- Introduces the club_memberships table to allow users to request to join clubs
-- and club administrators to manage the club roster.

BEGIN;

CREATE TABLE IF NOT EXISTS public.club_memberships (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    club_id integer NOT NULL,
    user_id uuid NOT NULL,
    status character varying(32) DEFAULT 'pending'::character varying NOT NULL,
    role character varying(32) DEFAULT 'member'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT club_memberships_pkey PRIMARY KEY (id),
    CONSTRAINT club_memberships_club_id_fkey FOREIGN KEY (club_id) REFERENCES public.clubs(id) ON DELETE CASCADE,
    CONSTRAINT club_memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE,
    CONSTRAINT club_memberships_club_user_unique UNIQUE (club_id, user_id),
    CONSTRAINT chk_club_memberships_status CHECK (status IN ('pending', 'approved', 'rejected')),
    CONSTRAINT chk_club_memberships_role CHECK (role IN ('member', 'officer', 'owner'))
);

-- Indexing for speed
CREATE INDEX IF NOT EXISTS idx_club_memberships_club_id ON public.club_memberships(club_id);
CREATE INDEX IF NOT EXISTS idx_club_memberships_user_id ON public.club_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_club_memberships_status ON public.club_memberships(status);

-- Enable Row Level Security (RLS)
ALTER TABLE public.club_memberships ENABLE ROW LEVEL SECURITY;

-- PostgREST/RLS Lockdown: only service_role can access.
REVOKE ALL ON public.club_memberships FROM PUBLIC;
REVOKE ALL ON public.club_memberships FROM anon;
REVOKE ALL ON public.club_memberships FROM authenticated;

GRANT ALL ON public.club_memberships TO service_role;

COMMIT;
