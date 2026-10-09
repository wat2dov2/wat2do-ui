-- Retry one explicitly approved cloud failure without losing a newer claim or routing change.

BEGIN;

CREATE OR REPLACE FUNCTION public.retry_failed_instagram_notification_media(
    p_expected_media jsonb,
    p_school_id integer,
    p_intended_recipient_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET timezone = 'UTC'
AS $$
DECLARE
    v_expected public.instagram_notification_media%ROWTYPE;
    v_key text;
BEGIN
    -- The failure journal and terminal workflow proof are caller responsibilities.
    -- Refuse projected, unbound, or malformed baselines before touching any row.
    IF p_school_id IS NULL OR p_school_id <= 0
       OR p_intended_recipient_id IS NULL
       OR p_intended_recipient_id !~ '^[1-9][0-9]{0,31}$'
       OR jsonb_typeof(p_expected_media) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'Failed media retry requires a valid full baseline and routing'
            USING ERRCODE = '23514';
    END IF;
    IF NOT p_expected_media ?& ARRAY[
        'id', 'notification_id', 'media_id', 'source_url', 'status', 'claim_token',
        'succeeded_at', 'failure_category', 'github_run_id', 'created_at', 'updated_at',
        'browser_delivery_generation'
    ] OR (SELECT count(*) FROM jsonb_object_keys(p_expected_media)) <> 12 THEN
        RAISE EXCEPTION 'Failed media retry requires a valid full baseline and routing'
            USING ERRCODE = '23514';
    END IF;
    FOREACH v_key IN ARRAY ARRAY[
        'id', 'notification_id', 'media_id', 'source_url', 'claim_token',
        'failure_category', 'github_run_id', 'created_at', 'updated_at'
    ] LOOP
        IF jsonb_typeof(p_expected_media -> v_key) IS DISTINCT FROM 'string' THEN
            RAISE EXCEPTION 'Failed media retry requires a valid full baseline and routing'
                USING ERRCODE = '23514';
        END IF;
    END LOOP;
    IF p_expected_media -> 'status' IS DISTINCT FROM '"failed"'::jsonb
       OR p_expected_media -> 'succeeded_at' IS DISTINCT FROM 'null'::jsonb
       OR p_expected_media ->> 'media_id' !~ '^[1-9][0-9]{0,31}$'
       OR p_expected_media ->> 'github_run_id' !~ '^[1-9][0-9]{0,49}$'
       OR p_expected_media ->> 'source_url' !~ '^https://(www\.)?instagram\.com/(p|reel|tv)/[A-Za-z0-9_-]+/?$'
       OR p_expected_media ->> 'failure_category' !~ '^[a-z0-9][a-z0-9_.:-]{0,99}$' THEN
        RAISE EXCEPTION 'Failed media retry requires a valid full baseline and routing'
            USING ERRCODE = '23514';
    END IF;
    FOREACH v_key IN ARRAY ARRAY['id', 'notification_id', 'claim_token', 'browser_delivery_generation'] LOOP
        IF v_key = 'browser_delivery_generation' AND p_expected_media -> v_key = 'null'::jsonb THEN
            CONTINUE;
        END IF;
        IF jsonb_typeof(p_expected_media -> v_key) IS DISTINCT FROM 'string'
           OR p_expected_media ->> v_key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           OR p_expected_media ->> v_key = '00000000-0000-0000-0000-000000000000' THEN
            RAISE EXCEPTION 'Failed media retry requires a valid full baseline and routing'
                USING ERRCODE = '23514';
        END IF;
    END LOOP;
    FOREACH v_key IN ARRAY ARRAY['created_at', 'updated_at'] LOOP
        IF p_expected_media ->> v_key !~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$' THEN
            RAISE EXCEPTION 'Failed media retry requires a valid full baseline and routing'
                USING ERRCODE = '23514';
        END IF;
    END LOOP;
    BEGIN
        SELECT * INTO v_expected
        FROM jsonb_populate_record(NULL::public.instagram_notification_media, p_expected_media);
    EXCEPTION WHEN data_exception THEN
        RAISE EXCEPTION 'Failed media retry requires a valid full baseline and routing'
            USING ERRCODE = '23514';
    END;

    -- Lock both authoritative routing rows through the CAS, including recipient
    -- changes which a key-share lock would permit between validation and reset.
    PERFORM 1
    FROM public.instagram_notifications AS notification
    JOIN public.schools AS school ON school.id = notification.school_id
    WHERE notification.id = v_expected.notification_id
      AND notification.school_id = p_school_id
      AND notification.intended_recipient_id = p_intended_recipient_id
      AND school.recipient_id = p_intended_recipient_id
    FOR SHARE OF notification, school;
    IF NOT FOUND THEN
        RETURN false;
    END IF;

    UPDATE public.instagram_notification_media AS media
    SET status = 'pending',
        claim_token = NULL,
        failure_category = NULL,
        github_run_id = NULL,
        succeeded_at = NULL,
        browser_delivery_generation = NULL,
        updated_at = GREATEST(clock_timestamp(), v_expected.updated_at + interval '1 microsecond')
    WHERE media.id = v_expected.id
      AND media.notification_id = v_expected.notification_id
      AND media.status = 'failed'
      AND to_jsonb(media) = p_expected_media;

    RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.retry_failed_instagram_notification_media(jsonb, integer, text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.retry_failed_instagram_notification_media(jsonb, integer, text)
    TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
