BEGIN;
CREATE TABLE IF NOT EXISTS public.position_interactions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
    session_id varchar(255) NOT NULL,
    position_id integer NOT NULL REFERENCES public.positions(id) ON DELETE CASCADE,
    interaction_type varchar(32) NOT NULL CHECK (interaction_type = 'click'),
    metadata jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.position_interactions ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS ix_position_interactions_position ON public.position_interactions(position_id);
CREATE INDEX IF NOT EXISTS ix_position_interactions_user_created ON public.position_interactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_position_interactions_session_created ON public.position_interactions(session_id, created_at DESC);
CREATE OR REPLACE FUNCTION public.get_position_click_counts(p_position_ids integer[])
RETURNS TABLE(position_id integer, click_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT position_id, count(*) FROM public.position_interactions
    WHERE position_id = ANY(p_position_ids) AND interaction_type = 'click'
    GROUP BY position_id;
$$;
REVOKE ALL ON FUNCTION public.get_position_click_counts(integer[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_position_click_counts(integer[]) TO service_role;
COMMIT;
