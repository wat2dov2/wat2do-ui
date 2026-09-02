BEGIN;

CREATE OR REPLACE FUNCTION public.claim_next_instagram_notification_media(
    p_notification_id uuid,
    p_github_run_id text
)
RETURNS TABLE (
    media_row_id uuid,
    source_url varchar(2048),
    claim_token uuid,
    intended_recipient_id varchar(32)
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_github_run_id IS NOT NULL
       AND btrim(p_github_run_id) !~ '^[0-9]{1,50}$'
    THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'instagram notification workflow run id is invalid';
    END IF;

    RETURN QUERY
    WITH pending AS (
        SELECT media.id, notification.intended_recipient_id
        FROM public.instagram_notification_media AS media
        JOIN public.instagram_notifications AS notification ON notification.id = media.notification_id
        WHERE media.notification_id = p_notification_id
          AND media.status = 'pending'
        ORDER BY media.created_at, media.id
        FOR UPDATE OF media SKIP LOCKED
        LIMIT 1
    )
    UPDATE public.instagram_notification_media AS media
    SET
        status = 'processing',
        claim_token = gen_random_uuid(),
        github_run_id = NULLIF(btrim(p_github_run_id), ''),
        updated_at = now()
    FROM pending
    WHERE media.id = pending.id
    RETURNING media.id, media.source_url, media.claim_token, pending.intended_recipient_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_next_pending_instagram_media(
    p_github_run_id text DEFAULT NULL
)
RETURNS TABLE (
    media_row_id uuid,
    source_url varchar(2048),
    claim_token uuid,
    intended_recipient_id varchar(32)
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_github_run_id IS NOT NULL
       AND btrim(p_github_run_id) !~ '^[0-9]{1,50}$'
    THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'instagram notification workflow run id is invalid';
    END IF;

    RETURN QUERY
    WITH pending AS (
        SELECT media.id, notification.intended_recipient_id
        FROM public.instagram_notification_media AS media
        JOIN public.instagram_notifications AS notification ON notification.id = media.notification_id
        WHERE media.status = 'pending'
        ORDER BY media.created_at, media.id
        FOR UPDATE OF media SKIP LOCKED
        LIMIT 1
    )
    UPDATE public.instagram_notification_media AS media
    SET
        status = 'processing',
        claim_token = gen_random_uuid(),
        github_run_id = NULLIF(btrim(p_github_run_id), ''),
        updated_at = now()
    FROM pending
    WHERE media.id = pending.id
    RETURNING media.id, media.source_url, media.claim_token, pending.intended_recipient_id;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
