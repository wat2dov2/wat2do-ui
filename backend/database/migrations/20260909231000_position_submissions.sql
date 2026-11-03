BEGIN;

ALTER TABLE public.positions ADD COLUMN IF NOT EXISTS is_paid boolean;

CREATE TABLE IF NOT EXISTS public.position_submissions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
    school_id integer NOT NULL REFERENCES public.schools(id) ON DELETE RESTRICT,
    position_data jsonb NOT NULL CHECK (jsonb_typeof(position_data) = 'object'),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    rejection_reason text,
    submitted_at timestamptz NOT NULL DEFAULT now(),
    reviewed_at timestamptz,
    reviewed_by uuid REFERENCES public.users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS position_submissions_review_idx
    ON public.position_submissions (status, submitted_at DESC, id);
ALTER TABLE public.position_submissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.position_submissions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.position_submissions TO service_role;

-- Lock the moderation row and publish in the same transaction.
CREATE OR REPLACE FUNCTION public.review_position_submission(
    p_id uuid, p_status text, p_reason text, p_reviewer uuid
) RETURNS SETOF public.position_submissions
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
    submission public.position_submissions;
    payload jsonb;
BEGIN
    SELECT * INTO submission FROM public.position_submissions WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RETURN; END IF;
    IF submission.status = p_status THEN RETURN NEXT submission; RETURN; END IF;
    IF submission.status <> 'pending' OR p_status NOT IN ('approved', 'rejected') THEN
        RAISE EXCEPTION 'Invalid status transition' USING ERRCODE = '23514';
    END IF;
    IF p_status = 'approved' THEN
        payload := submission.position_data;
        INSERT INTO public.positions (
            organization_id, school_id, title, description, position_type,
            requirements, commitment, compensation, is_paid, location,
            contact_email, deadline_date, deadline_at, source_url, source_image_url,
            ingestion_source
        ) VALUES (
            (payload->>'organization_id')::integer, submission.school_id,
            payload->>'title', payload->>'description', payload->>'position_type',
            coalesce(payload->'requirements', '[]'::jsonb), payload->>'commitment',
            payload->>'compensation', (payload->>'is_paid')::boolean, payload->>'location',
            payload->>'contact_email', (payload->>'deadline_date')::date,
            (payload->>'deadline_at')::timestamptz, payload->>'source_url',
            payload->>'source_image_url', 'manual'
        );
    END IF;
    UPDATE public.position_submissions SET status = p_status,
        rejection_reason = p_reason, reviewed_at = now(), reviewed_by = p_reviewer
        WHERE id = p_id RETURNING * INTO submission;
    RETURN NEXT submission;
END;
$$;
REVOKE ALL ON FUNCTION public.review_position_submission(uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_position_submission(uuid, text, text, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
