-- Roll back a claimed Instagram media item to pending for transient infrastructure failures.

BEGIN;

CREATE OR REPLACE FUNCTION public.rollback_instagram_notification_media(
    p_media_row_id uuid,
    p_claim_token uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.instagram_notification_media AS media
    SET
        status = 'pending',
        claim_token = NULL,
        github_run_id = NULL,
        updated_at = now()
    WHERE media.id = p_media_row_id
      AND media.claim_token = p_claim_token
      AND media.status = 'processing';

    RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.rollback_instagram_notification_media(
    uuid,
    uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rollback_instagram_notification_media(
    uuid,
    uuid
) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
