-- Each signed-in user's notification inbox, under the bell in the top bar.
-- Every notification email we send a user also leaves one row here, written
-- where that email is sent: the morning email, event reminders, event change
-- alerts, ticket emails, review decisions and club invitations. Login codes
-- are not notifications and never land here.
-- A row keeps only what its words need (an event's title, how many tickets);
-- the site writes the words in the reader's language from `kind` and `details`.

CREATE TABLE IF NOT EXISTS public.user_notifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    kind text NOT NULL,
    event_id integer REFERENCES public.events(id) ON DELETE SET NULL,
    details jsonb NOT NULL DEFAULT '{}'::jsonb,
    link text,
    created_at timestamptz NOT NULL DEFAULT now(),
    read_at timestamptz,
    CONSTRAINT user_notifications_kind_check CHECK (kind IN (
        'morning_email',
        'event_reminder',
        'event_change',
        'event_cancelled',
        'tickets',
        'ticket_refunded',
        'refund_requested',
        'refund_declined',
        'review_decision',
        'club_invitation'
    )),
    CONSTRAINT user_notifications_details_object CHECK (jsonb_typeof(details) = 'object')
);

CREATE INDEX IF NOT EXISTS user_notifications_user_created_idx
    ON public.user_notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS user_notifications_event_idx
    ON public.user_notifications (event_id);

ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_notifications FROM PUBLIC;
GRANT ALL ON public.user_notifications TO service_role;

COMMENT ON TABLE public.user_notifications IS
    'One row per notification email sent to a user, shown in their inbox under the top bar''s bell.';
COMMENT ON COLUMN public.user_notifications.details IS
    'What the notification''s words need: name (an event''s title or a club''s name), tickets (how many), reviewed (club, claim, event or position) and approved.';
COMMENT ON COLUMN public.user_notifications.link IS
    'Where the notification leads, the same page its email links to, on the right school''s site.';

-- One notification for one user, written beside the email it repeats. The
-- user's rows older than the inbox keeps (controlbox notification_inbox.json
-- retention_days) go at the same time, so the inbox never grows past it.
CREATE OR REPLACE FUNCTION public.record_user_notification(
    p_user_id uuid,
    p_kind text,
    p_event_id integer,
    p_details jsonb,
    p_link text,
    p_retention_days integer
)
RETURNS void
LANGUAGE sql
SET search_path = public
AS $$
    DELETE FROM public.user_notifications
    WHERE user_id = p_user_id
      AND created_at < now() - make_interval(days => p_retention_days);
    INSERT INTO public.user_notifications (user_id, kind, event_id, details, link)
    VALUES (p_user_id, p_kind, p_event_id, COALESCE(p_details, '{}'::jsonb), p_link);
$$;

-- The same, for an email sent to an address: the notification goes to the
-- user signed up with that address, and to nobody when there is none.
CREATE OR REPLACE FUNCTION public.record_user_notification_for_email(
    p_email text,
    p_kind text,
    p_event_id integer,
    p_details jsonb,
    p_link text,
    p_retention_days integer
)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_user_id uuid;
BEGIN
    -- Addresses are stored lowercased (one user per address).
    SELECT id INTO v_user_id FROM public.users WHERE email = lower(btrim(p_email));
    IF v_user_id IS NOT NULL THEN
        PERFORM public.record_user_notification(
            v_user_id, p_kind, p_event_id, p_details, p_link, p_retention_days
        );
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.record_user_notification(uuid, text, integer, jsonb, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_user_notification_for_email(text, text, integer, jsonb, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_user_notification(uuid, text, integer, jsonb, text, integer),
    public.record_user_notification_for_email(text, text, integer, jsonb, text, integer)
    TO service_role;
