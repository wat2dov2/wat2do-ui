-- Outreach leads get a pitch and a claim link.
--
-- Each lead's club is judged by Claude from its own events (services/outreach/pitch.py):
-- only a club whose events students would come out for (socials, nights out, free food,
-- crafts, hackathons, design jams) is a fit, and a fit lead keeps the video script the
-- admin records and the personal email that goes with the video. The admin page lists
-- fit leads only; a lead judged not a fit keeps its row so the sweep never adds it again.
--
-- Every lead also gets a claim token: the email links /claim/<token> on the club's school
-- site, and whoever opens it signed in becomes the club's owner while nobody manages it.
--
-- The sweep marked claimed every lead past the first thousand: it asked the data API
-- which clubs were still unclaimed, and the API answers at most a thousand rows. Those
-- leads go back to new, and leads are now marked claimed in one statement here.

BEGIN;

ALTER TABLE public.outreach_leads
    ADD COLUMN claim_token uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    -- Null until Claude judges the club; false keeps only the reason.
    ADD COLUMN pitch_fit boolean,
    ADD COLUMN pitch_reason text,
    ADD COLUMN pitch_script text,
    ADD COLUMN pitch_email_subject text,
    -- The admin page fills {{claim_url}} with the lead's claim link.
    ADD COLUMN pitch_email_body text CHECK (pitch_email_body LIKE '%{{claim_url}}%'),
    ADD COLUMN pitched_at timestamptz,
    ADD CONSTRAINT outreach_leads_pitch_check CHECK (
        (pitch_fit IS NULL AND pitch_reason IS NULL AND pitch_script IS NULL
            AND pitch_email_subject IS NULL AND pitch_email_body IS NULL AND pitched_at IS NULL)
        OR (pitch_fit = false AND pitch_reason IS NOT NULL AND pitch_script IS NULL
            AND pitch_email_subject IS NULL AND pitch_email_body IS NULL AND pitched_at IS NOT NULL)
        OR (pitch_fit = true AND pitch_reason IS NOT NULL AND pitch_script IS NOT NULL
            AND pitch_email_subject IS NOT NULL AND pitch_email_body IS NOT NULL
            AND pitched_at IS NOT NULL)
    );

DROP INDEX public.outreach_leads_review_idx;
DROP INDEX public.outreach_leads_formality_idx;
CREATE INDEX outreach_leads_review_idx
    ON public.outreach_leads (status, found_at DESC, id) WHERE email IS NOT NULL AND pitch_fit;
CREATE INDEX outreach_leads_formality_idx
    ON public.outreach_leads (status, formality DESC NULLS LAST, id)
    WHERE email IS NOT NULL AND pitch_fit;

-- A club is claimed once it has a creator or any member.
UPDATE public.outreach_leads AS lead SET status = 'new'
FROM public.clubs AS club
WHERE club.id = lead.club_id
    AND lead.status = 'claimed'
    AND club.created_by IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.club_members AS member WHERE member.club_id = club.id);

DROP FUNCTION public.outreach_unclaimed(integer[]);

-- Leads whose club has since been claimed move to claimed; returns how many moved.
CREATE FUNCTION public.outreach_mark_claimed()
RETURNS integer
LANGUAGE sql
VOLATILE
SET search_path = ''
AS $$
    WITH moved AS (
        UPDATE public.outreach_leads AS lead SET status = 'claimed'
        FROM public.clubs AS club
        WHERE club.id = lead.club_id
            AND lead.status <> 'claimed'
            AND (club.created_by IS NOT NULL
                OR EXISTS (SELECT 1 FROM public.club_members AS member
                    WHERE member.club_id = club.id))
        RETURNING lead.id
    )
    SELECT count(*)::integer FROM moved;
$$;
REVOKE ALL ON FUNCTION public.outreach_mark_claimed() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.outreach_mark_claimed() TO service_role;

-- Leads at the given schools to pitch: unclaimed, with an email, never judged or judged
-- not a fit before p_recheck_before; each with its club and its newest events.
CREATE FUNCTION public.outreach_unpitched(
    p_schools text[], p_limit integer, p_recheck_before timestamptz, p_event_limit integer
)
RETURNS TABLE (
    lead_id uuid, club_name text, school_name text, ig text, club_page text,
    categories jsonb, events jsonb
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT lead.id, club.club_name::text, school.name::text, club.ig::text, club.club_page::text,
        club.categories,
        coalesce((
            SELECT jsonb_agg(jsonb_build_object(
                'title', event.title,
                'starts', event.dtstart_utc,
                'location', event.location,
                'price', event.price,
                'free_food', event.free_food_on_campus,
                'food', event.food,
                'description', left(event.description, 600)
            ) ORDER BY event.dtstart_utc DESC)
            FROM (
                SELECT * FROM public.events AS event
                WHERE (event.club_id = club.id OR club.id = ANY (event.cohost_club_ids))
                    AND NOT event.cancelled
                ORDER BY event.dtstart_utc DESC NULLS LAST
                LIMIT p_event_limit
            ) AS event
        ), '[]'::jsonb)
    FROM public.outreach_leads AS lead
    JOIN public.clubs AS club ON club.id = lead.club_id
    JOIN public.schools AS school ON school.id = club.school_id
    WHERE school.slug = ANY (p_schools)
        AND lead.email IS NOT NULL
        AND lead.status <> 'claimed'
        AND (lead.pitch_fit IS NULL OR (NOT lead.pitch_fit AND lead.pitched_at < p_recheck_before))
    ORDER BY lead.pitch_fit NULLS FIRST, lead.found_at DESC, lead.id
    LIMIT p_limit;
$$;
REVOKE ALL ON FUNCTION public.outreach_unpitched(text[], integer, timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.outreach_unpitched(text[], integer, timestamptz, integer)
    TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
