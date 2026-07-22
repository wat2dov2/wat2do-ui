-- Consolidate digest preferences and make delivery claims safely retryable.

BEGIN;

DELETE FROM public.notification_preferences
WHERE notification_type IN (
    'morning_digest',
    'weekly_digest',
    'daily_new_events'
);

ALTER TABLE public.notifications_log
    ADD COLUMN attempt_count integer NOT NULL DEFAULT 0,
    ADD COLUMN last_attempt_at timestamptz,
    ADD COLUMN failure_category text;

CREATE OR REPLACE FUNCTION public.claim_notification_delivery(
    p_user_id uuid,
    p_notification_type text,
    p_target_id text,
    p_changed_fields jsonb DEFAULT NULL,
    p_stale_before timestamptz DEFAULT now() - interval '30 minutes'
)
RETURNS TABLE(
    id uuid,
    claimed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id uuid;
BEGIN
    INSERT INTO public.notifications_log (
        user_id,
        notification_type,
        target_id,
        channel,
        status,
        changed_fields,
        attempt_count,
        last_attempt_at
    )
    VALUES (
        p_user_id,
        p_notification_type,
        p_target_id,
        'email',
        'pending',
        p_changed_fields,
        1,
        now()
    )
    ON CONFLICT (user_id, notification_type, target_id, channel)
    DO NOTHING
    RETURNING notifications_log.id INTO v_id;

    IF v_id IS NOT NULL THEN
        RETURN QUERY SELECT v_id, true;
        RETURN;
    END IF;

    UPDATE public.notifications_log AS delivery
    SET
        status = 'pending',
        attempt_count = delivery.attempt_count + 1,
        last_attempt_at = now(),
        failure_category = NULL
    WHERE delivery.user_id = p_user_id
      AND delivery.notification_type = p_notification_type
      AND delivery.target_id = p_target_id
      AND delivery.channel = 'email'
      AND (
          delivery.status = 'failed'
          OR (
              delivery.status = 'pending'
              AND delivery.last_attempt_at < p_stale_before
          )
      )
    RETURNING delivery.id INTO v_id;

    RETURN QUERY
    SELECT
        COALESCE(
            v_id,
            (
                SELECT delivery.id
                FROM public.notifications_log AS delivery
                WHERE delivery.user_id = p_user_id
                  AND delivery.notification_type = p_notification_type
                  AND delivery.target_id = p_target_id
                  AND delivery.channel = 'email'
            )
        ),
        v_id IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_notification_delivery(
    uuid, text, text, jsonb, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_notification_delivery(
    uuid, text, text, jsonb, timestamptz
) FROM anon;
REVOKE ALL ON FUNCTION public.claim_notification_delivery(
    uuid, text, text, jsonb, timestamptz
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_notification_delivery(
    uuid, text, text, jsonb, timestamptz
) TO service_role;

COMMIT;
