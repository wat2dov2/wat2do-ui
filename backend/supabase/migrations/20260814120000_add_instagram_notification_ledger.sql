-- Record Instagram notification materialization, then irreversibly claim one
-- recovered media item immediately before at-most-once processing.

BEGIN;

ALTER TABLE public.schools
    DROP CONSTRAINT IF EXISTS schools_recipient_id_check;
ALTER TABLE public.schools
    ADD CONSTRAINT schools_recipient_id_check
    CHECK (recipient_id IS NULL OR recipient_id ~ '^[1-9][0-9]{0,31}$');

CREATE TABLE IF NOT EXISTS public.instagram_notifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id integer NOT NULL
        REFERENCES public.schools(id) ON DELETE RESTRICT,
    intended_recipient_id varchar(32) NOT NULL,
    push_id varchar(255) NOT NULL,
    push_category varchar(100) NOT NULL,
    cache_ent_id varchar(255),
    total_non_mmc_media_count integer,
    materialized_media_count integer NOT NULL,
    materialization_status varchar(16) NOT NULL,
    first_seen_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT instagram_notifications_recipient_check
        CHECK (intended_recipient_id ~ '^[1-9][0-9]{0,31}$'),
    CONSTRAINT instagram_notifications_push_id_check
        CHECK (length(btrim(push_id)) > 0),
    CONSTRAINT instagram_notifications_push_category_check
        CHECK (length(btrim(push_category)) > 0),
    CONSTRAINT instagram_notifications_cache_ent_id_check
        CHECK (cache_ent_id IS NULL OR length(btrim(cache_ent_id)) > 0),
    CONSTRAINT instagram_notifications_total_count_check
        CHECK (
            total_non_mmc_media_count IS NULL
            OR total_non_mmc_media_count >= 0
        ),
    CONSTRAINT instagram_notifications_materialized_count_check
        CHECK (materialized_media_count >= 0),
    CONSTRAINT instagram_notifications_materialization_check
        CHECK (
            (
                materialization_status = 'incomplete'
                AND total_non_mmc_media_count IS NOT NULL
                AND materialized_media_count < total_non_mmc_media_count
            )
            OR (
                materialization_status = 'complete'
                AND (
                    total_non_mmc_media_count IS NULL
                    OR materialized_media_count >= total_non_mmc_media_count
                )
            )
        ),
    CONSTRAINT instagram_notifications_recipient_push_key
        UNIQUE (intended_recipient_id, push_id)
);

CREATE TABLE IF NOT EXISTS public.instagram_notification_media (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    notification_id uuid NOT NULL
        REFERENCES public.instagram_notifications(id) ON DELETE CASCADE,
    media_id varchar(32) NOT NULL,
    source_url varchar(2048) NOT NULL,
    status varchar(16) NOT NULL DEFAULT 'pending',
    claim_token uuid,
    succeeded_at timestamptz,
    failure_category varchar(100),
    github_run_id varchar(50),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT instagram_notification_media_id_check
        CHECK (media_id ~ '^[1-9][0-9]{0,31}$'),
    CONSTRAINT instagram_notification_media_source_url_check
        CHECK (
            source_url ~ '^https://(www\.)?instagram\.com/(p|reel|tv)/[A-Za-z0-9_-]+/?$'
        ),
    CONSTRAINT instagram_notification_media_status_check
        CHECK (status IN ('pending', 'processing', 'succeeded', 'failed')),
    CONSTRAINT instagram_notification_media_github_run_id_check
        CHECK (github_run_id IS NULL OR github_run_id ~ '^[0-9]{1,50}$'),
    CONSTRAINT instagram_notification_media_terminal_state_check
        CHECK (
            (
                status = 'pending'
                AND claim_token IS NULL
                AND github_run_id IS NULL
                AND succeeded_at IS NULL
                AND failure_category IS NULL
            )
            OR (
                status = 'processing'
                AND claim_token IS NOT NULL
                AND succeeded_at IS NULL
                AND failure_category IS NULL
            )
            OR (
                status = 'succeeded'
                AND claim_token IS NOT NULL
                AND succeeded_at IS NOT NULL
                AND failure_category IS NULL
            )
            OR (
                status = 'failed'
                AND claim_token IS NOT NULL
                AND succeeded_at IS NULL
                AND failure_category IS NOT NULL
                AND failure_category ~ '^[a-z0-9][a-z0-9_.:-]{0,99}$'
            )
        ),
    CONSTRAINT instagram_notification_media_notification_media_key
        UNIQUE (notification_id, media_id)
);

ALTER TABLE public.instagram_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instagram_notification_media ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.instagram_notifications
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.instagram_notification_media
    FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.instagram_notifications TO service_role;
GRANT ALL ON TABLE public.instagram_notification_media TO service_role;

CREATE OR REPLACE FUNCTION public.record_instagram_notification_media(
    p_school_id integer,
    p_intended_recipient_id text,
    p_push_id text,
    p_push_category text,
    p_cache_ent_id text,
    p_total_non_mmc_media_count integer,
    p_media jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_notification_id uuid;
    v_materialized_media_count integer;
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.schools AS school
        WHERE school.id = p_school_id
          AND school.recipient_id = btrim(p_intended_recipient_id)
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'instagram notification school recipient mismatch';
    END IF;

    IF p_push_id IS NULL OR length(btrim(p_push_id)) = 0 THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'instagram notification push id is required';
    END IF;
    IF p_push_category IS NULL OR length(btrim(p_push_category)) = 0 THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'instagram notification push category is required';
    END IF;
    IF p_total_non_mmc_media_count IS NOT NULL
       AND p_total_non_mmc_media_count < 0
    THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'instagram notification media count is invalid';
    END IF;
    IF p_media IS NULL OR jsonb_typeof(p_media) <> 'array' THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'instagram notification media must be an array';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_media) AS item(value)
        WHERE jsonb_typeof(item.value) <> 'object'
           OR COALESCE(jsonb_typeof(item.value -> 'media_id'), '') <> 'string'
           OR COALESCE(jsonb_typeof(item.value -> 'source_url'), '') <> 'string'
           OR btrim(item.value ->> 'media_id') !~ '^[1-9][0-9]{0,31}$'
           OR btrim(item.value ->> 'source_url')
                !~ '^https://(www\.)?instagram\.com/(p|reel|tv)/[A-Za-z0-9_-]+/?$'
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'instagram notification media item is invalid';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_media) AS item(value)
        GROUP BY btrim(item.value ->> 'media_id')
        HAVING count(DISTINCT btrim(item.value ->> 'source_url')) > 1
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'instagram notification media URL conflicts with media id';
    END IF;

    INSERT INTO public.instagram_notifications AS stored (
        school_id,
        intended_recipient_id,
        push_id,
        push_category,
        cache_ent_id,
        total_non_mmc_media_count,
        materialized_media_count,
        materialization_status
    )
    VALUES (
        p_school_id,
        btrim(p_intended_recipient_id),
        btrim(p_push_id),
        btrim(p_push_category),
        NULLIF(btrim(p_cache_ent_id), ''),
        p_total_non_mmc_media_count,
        0,
        CASE
            WHEN p_total_non_mmc_media_count IS NOT NULL
             AND p_total_non_mmc_media_count > 0
            THEN 'incomplete'
            ELSE 'complete'
        END
    )
    ON CONFLICT ON CONSTRAINT instagram_notifications_recipient_push_key
    DO UPDATE SET
        cache_ent_id = COALESCE(stored.cache_ent_id, EXCLUDED.cache_ent_id),
        total_non_mmc_media_count = COALESCE(
            stored.total_non_mmc_media_count,
            EXCLUDED.total_non_mmc_media_count
        ),
        materialization_status = CASE
            WHEN COALESCE(
                stored.total_non_mmc_media_count,
                EXCLUDED.total_non_mmc_media_count
            ) IS NOT NULL
             AND stored.materialized_media_count < COALESCE(
                stored.total_non_mmc_media_count,
                EXCLUDED.total_non_mmc_media_count
            )
            THEN 'incomplete'
            ELSE 'complete'
        END,
        last_seen_at = now()
    WHERE stored.school_id = EXCLUDED.school_id
      AND stored.push_category = EXCLUDED.push_category
      AND (
          stored.cache_ent_id IS NULL
          OR EXCLUDED.cache_ent_id IS NULL
          OR stored.cache_ent_id = EXCLUDED.cache_ent_id
      )
      AND (
          stored.total_non_mmc_media_count IS NULL
          OR EXCLUDED.total_non_mmc_media_count IS NULL
          OR stored.total_non_mmc_media_count = EXCLUDED.total_non_mmc_media_count
      )
    RETURNING stored.id INTO v_notification_id;

    IF v_notification_id IS NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'instagram notification metadata conflicts with existing push';
    END IF;

    IF EXISTS (
        WITH canonical_media AS (
            SELECT DISTINCT ON (btrim(item.value ->> 'media_id'))
                btrim(item.value ->> 'media_id') AS media_id,
                btrim(item.value ->> 'source_url') AS source_url
            FROM jsonb_array_elements(p_media) WITH ORDINALITY AS item(value, ordinal)
            ORDER BY btrim(item.value ->> 'media_id'), item.ordinal
        )
        SELECT 1
        FROM canonical_media AS incoming
        JOIN public.instagram_notification_media AS stored_media
          ON stored_media.notification_id = v_notification_id
         AND stored_media.media_id = incoming.media_id
        WHERE stored_media.source_url <> incoming.source_url
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'instagram notification media URL conflicts with stored media';
    END IF;

    WITH parsed_media AS (
        SELECT
            btrim(item.value ->> 'media_id') AS media_id,
            btrim(item.value ->> 'source_url') AS source_url,
            item.ordinal
        FROM jsonb_array_elements(p_media) WITH ORDINALITY AS item(value, ordinal)
    ),
    canonical_media AS (
        SELECT DISTINCT ON (parsed.media_id)
            parsed.media_id,
            parsed.source_url,
            parsed.ordinal
        FROM parsed_media AS parsed
        ORDER BY parsed.media_id, parsed.ordinal
    )
    INSERT INTO public.instagram_notification_media (
        notification_id,
        media_id,
        source_url,
        status
    )
    SELECT
        v_notification_id,
        incoming.media_id,
        incoming.source_url,
        'pending'
    FROM canonical_media AS incoming
    ORDER BY incoming.ordinal
    ON CONFLICT ON CONSTRAINT instagram_notification_media_notification_media_key
    DO NOTHING;

    SELECT count(*)::integer
    INTO v_materialized_media_count
    FROM public.instagram_notification_media AS media
    WHERE media.notification_id = v_notification_id;

    UPDATE public.instagram_notifications AS notification
    SET
        materialized_media_count = v_materialized_media_count,
        materialization_status = CASE
            WHEN notification.total_non_mmc_media_count IS NOT NULL
             AND v_materialized_media_count < notification.total_non_mmc_media_count
            THEN 'incomplete'
            ELSE 'complete'
        END
    WHERE notification.id = v_notification_id;

    RETURN v_notification_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_next_instagram_notification_media(
    p_notification_id uuid,
    p_github_run_id text
)
RETURNS TABLE (
    media_row_id uuid,
    source_url varchar(2048),
    claim_token uuid
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
        SELECT media.id
        FROM public.instagram_notification_media AS media
        WHERE media.notification_id = p_notification_id
          AND media.status = 'pending'
        ORDER BY media.created_at, media.id
        FOR UPDATE SKIP LOCKED
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
    RETURNING media.id, media.source_url, media.claim_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_instagram_notification_media(
    p_media_row_id uuid,
    p_claim_token uuid,
    p_status text,
    p_failure_category text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_failure_category varchar(100);
BEGIN
    IF p_status = 'succeeded' THEN
        IF p_failure_category IS NOT NULL THEN
            RAISE EXCEPTION USING
                ERRCODE = '23514',
                MESSAGE = 'successful Instagram media cannot have a failure category';
        END IF;
    ELSIF p_status = 'failed' THEN
        v_failure_category := NULLIF(btrim(p_failure_category), '');
        IF v_failure_category IS NULL
           OR v_failure_category !~ '^[a-z0-9][a-z0-9_.:-]{0,99}$'
        THEN
            RAISE EXCEPTION USING
                ERRCODE = '23514',
                MESSAGE = 'Instagram media failure category is invalid';
        END IF;
    ELSE
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'Instagram media final status is invalid';
    END IF;

    UPDATE public.instagram_notification_media AS media
    SET
        status = p_status,
        succeeded_at = CASE WHEN p_status = 'succeeded' THEN now() ELSE NULL END,
        failure_category = v_failure_category,
        updated_at = now()
    WHERE media.id = p_media_row_id
      AND media.claim_token = p_claim_token
      AND media.status = 'processing';

    RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.record_instagram_notification_media(
    integer,
    text,
    text,
    text,
    text,
    integer,
    jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_instagram_notification_media(
    integer,
    text,
    text,
    text,
    text,
    integer,
    jsonb
) TO service_role;

REVOKE ALL ON FUNCTION public.claim_next_instagram_notification_media(
    uuid,
    text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_instagram_notification_media(
    uuid,
    text
) TO service_role;

REVOKE ALL ON FUNCTION public.finalize_instagram_notification_media(
    uuid,
    uuid,
    text,
    text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_instagram_notification_media(
    uuid,
    uuid,
    text,
    text
) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
