BEGIN;

CREATE TABLE IF NOT EXISTS public.notification_consent_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    notification_type text NOT NULL,
    enabled boolean NOT NULL,
    source text NOT NULL CHECK (source IN ('settings', 'unsubscribe')),
    notice_version text NOT NULL CHECK (length(btrim(notice_version)) > 0),
    recorded_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_consent_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_consent_history FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.notification_consent_history FROM service_role;
GRANT SELECT, INSERT ON public.notification_consent_history TO service_role;

CREATE INDEX IF NOT EXISTS notification_consent_history_user_recorded_idx
    ON public.notification_consent_history (user_id, recorded_at DESC);

-- The service-role API resolves the authenticated user and source before calling.
-- No browser role can invoke this function or edit the evidence directly.
CREATE OR REPLACE FUNCTION public.set_notification_preferences(
    p_user_id uuid,
    p_updates jsonb,
    p_source text,
    p_notice_version text
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    choice jsonb;
BEGIN
    IF p_source IS NULL OR p_source NOT IN ('settings', 'unsubscribe')
        OR p_notice_version IS NULL OR length(btrim(p_notice_version)) = 0
        OR p_updates IS NULL OR jsonb_typeof(p_updates) <> 'array' THEN
        RAISE EXCEPTION 'Invalid notification preference evidence';
    END IF;
    IF jsonb_array_length(p_updates) NOT BETWEEN 1 AND 32 THEN
        RAISE EXCEPTION 'Invalid notification preference count';
    END IF;

    -- Serialize choices for the same user, including unsubscribe requests.
    PERFORM id FROM public.users WHERE id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Notification preference user not found';
    END IF;

    FOR choice IN SELECT value FROM jsonb_array_elements(p_updates) LOOP
        IF choice->>'notification_type' IS NULL
            OR choice->>'notification_type' NOT IN ('morning_email', 'event_reminder', 'event_change')
            OR jsonb_typeof(choice->'enabled') IS DISTINCT FROM 'boolean'
            OR (p_source = 'unsubscribe' AND (choice->>'enabled')::boolean) THEN
            RAISE EXCEPTION 'Invalid notification preference choice';
        END IF;

        INSERT INTO public.notification_preferences (user_id, notification_type, enabled, updated_at)
        VALUES (p_user_id, choice->>'notification_type', (choice->>'enabled')::boolean, now())
        ON CONFLICT (user_id, notification_type) DO UPDATE
            SET enabled = EXCLUDED.enabled, updated_at = EXCLUDED.updated_at;

        INSERT INTO public.notification_consent_history
            (user_id, notification_type, enabled, source, notice_version)
        VALUES (p_user_id, choice->>'notification_type', (choice->>'enabled')::boolean,
                p_source, p_notice_version);
    END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.set_notification_preferences(uuid, jsonb, text, text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_notification_preferences(uuid, jsonb, text, text)
    TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
