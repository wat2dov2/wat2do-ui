-- Outreach pitches judge fit more strictly, and never pitch a club out of carousels.
--
-- The first pass judged 127 of 147 uwaterloo clubs a fit, counting bake sales,
-- tournaments for players and meetings with free pizza; the prompt now leaves those out
-- (services/outreach/pitch_prompt.md), so every lead judged a fit is judged again.
-- A club in public.instagram_excluded_clubs is never pitched, since the pitch promises
-- features in our Instagram carousels; its lead keeps no pitch and stays off the page.

BEGIN;

-- Leads at the given schools to pitch: unclaimed, with an email, never judged or judged
-- not a fit before p_recheck_before, and not out of carousels; each with its club and
-- its newest events.
CREATE OR REPLACE FUNCTION public.outreach_unpitched(
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
        -- A club that asked to stay out of carousels (Hillel's accounts among them) is
        -- never pitched, since the pitch promises carousel features; its handle is
        -- matched as the carousel jobs match it: trimmed, without its "@", lower-cased.
        AND NOT EXISTS (
            SELECT 1 FROM public.instagram_excluded_clubs AS excluded
            WHERE excluded.ig_handle = lower(ltrim(btrim(club.ig), '@'))
        )
        AND (lead.pitch_fit IS NULL OR (NOT lead.pitch_fit AND lead.pitched_at < p_recheck_before))
    ORDER BY lead.pitch_fit NULLS FIRST, lead.found_at DESC, lead.id
    LIMIT p_limit;
$$;
UPDATE public.outreach_leads SET pitch_fit = NULL, pitch_reason = NULL, pitch_script = NULL,
    pitch_email_subject = NULL, pitch_email_body = NULL, pitched_at = NULL
WHERE pitch_fit;

NOTIFY pgrst, 'reload schema';

COMMIT;
