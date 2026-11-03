BEGIN;

DROP FUNCTION IF EXISTS public.record_instagram_notification_media(integer, text, text, text, text, integer, jsonb);

CREATE OR REPLACE FUNCTION public.record_instagram_notification_media(
    p_school_id integer,
    p_intended_recipient_id text,
    p_push_id text,
    p_push_category text,
    p_cache_ent_id text,
    p_total_non_mmc_media_count integer,
    p_media jsonb
)
RETURNS TABLE (
    notification_id uuid,
    newly_inserted_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_notification_id uuid;
    v_materialized_media_count integer;
    v_newly_inserted_count integer;
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

    GET DIAGNOSTICS v_newly_inserted_count = ROW_COUNT;

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

    RETURN QUERY SELECT v_notification_id, v_newly_inserted_count;
END;
$$;

NOTIFY pgrst, 'reload schema';

REVOKE ALL ON FUNCTION public.record_instagram_notification_media(integer, text, text, text, text, integer, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.record_instagram_notification_media(integer, text, text, text, text, integer, jsonb) TO service_role;

COMMIT;
