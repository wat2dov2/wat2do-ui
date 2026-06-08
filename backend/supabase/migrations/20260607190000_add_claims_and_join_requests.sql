-- Migration: add_claims_and_join_requests
-- Created: 2026-06-07

BEGIN;

-- 1. Club Claims Table
CREATE TABLE IF NOT EXISTS public.club_claims (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id integer NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    executive_role varchar(100) NOT NULL,
    proof_url text,
    status varchar(32) NOT NULL DEFAULT 'pending',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_club_claims_club_user UNIQUE (club_id, user_id),
    CONSTRAINT chk_club_claims_status CHECK (status IN ('pending', 'approved', 'rejected'))
);

ALTER TABLE public.club_claims ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS ix_club_claims_club_id ON public.club_claims (club_id);
CREATE INDEX IF NOT EXISTS ix_club_claims_user_id ON public.club_claims (user_id);
CREATE INDEX IF NOT EXISTS ix_club_claims_status ON public.club_claims (status);

-- 2. Club Join Requests Table
CREATE TABLE IF NOT EXISTS public.club_join_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id integer NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    pitch text NOT NULL,
    status varchar(32) NOT NULL DEFAULT 'pending',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_club_join_requests UNIQUE (club_id, user_id),
    CONSTRAINT chk_club_join_requests_status CHECK (status IN ('pending', 'approved', 'rejected'))
);

ALTER TABLE public.club_join_requests ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS ix_club_join_requests_club_id ON public.club_join_requests (club_id);
CREATE INDEX IF NOT EXISTS ix_club_join_requests_user_id ON public.club_join_requests (user_id);
CREATE INDEX IF NOT EXISTS ix_club_join_requests_status ON public.club_join_requests (status);

-- 3. RLS Permissive Policies for Authenticated Users
-- Claims: Users can insert their own claims; read their own claims; admins can do all.
CREATE POLICY select_own_claims ON public.club_claims
    FOR SELECT TO authenticated USING (
        EXISTS (
            SELECT 1 FROM public.users u 
            WHERE u.supabase_auth_id = auth.uid()::text AND u.id = user_id
        )
        OR EXISTS (
            SELECT 1 FROM public.users u 
            WHERE u.supabase_auth_id = auth.uid()::text AND u.role = 'admin'
        )
    );

CREATE POLICY insert_own_claims ON public.club_claims
    FOR INSERT TO authenticated WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.users u 
            WHERE u.supabase_auth_id = auth.uid()::text AND u.id = user_id
        )
    );

-- Join Requests: Users can insert their own requests; read their own requests; club members/admins can read requests for their clubs.
CREATE POLICY select_join_requests ON public.club_join_requests
    FOR SELECT TO authenticated USING (
        EXISTS (
            SELECT 1 FROM public.users u 
            WHERE u.supabase_auth_id = auth.uid()::text AND u.id = user_id
        )
        OR EXISTS (
            SELECT 1 FROM public.users u 
            WHERE u.supabase_auth_id = auth.uid()::text AND u.role = 'admin'
        )
        OR EXISTS (
            SELECT 1 FROM public.club_members cm 
            JOIN public.users u ON cm.user_id = u.id 
            WHERE u.supabase_auth_id = auth.uid()::text AND cm.club_id = club_id
        )
    );

CREATE POLICY insert_own_join_requests ON public.club_join_requests
    FOR INSERT TO authenticated WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.users u 
            WHERE u.supabase_auth_id = auth.uid()::text AND u.id = user_id
        )
    );

COMMIT;
