-- Outreach pitches read each event's real dates, and every pitched lead is pitched again.
--
-- Event dates live in public.event_dates; public.events.dtstart_utc is a leftover column
-- empty for four in five events, so pitches saw events without dates, and clubs with
-- more events than p_event_limit lost their newest ones to the old ones that had it.
-- Each event now carries `starts` (its next date, or its last one once all have passed)
-- and `upcoming`, so a club's video can be about the event it has coming up.
-- Scripts are also written to a new, relaxed brief that opens with a hook
-- (services/outreach/pitch_prompt.md, hooks.md), so every judged lead is judged again.

BEGIN;

-- Leads at the given schools to pitch: unclaimed, with an email, never judged or judged
-- not a fit before p_recheck_before, and not out of carousels; each with its club and
-- its newest events, those still to come first.
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
                'starts', coalesce(event.next_start, event.last_start),
                'upcoming', event.next_start IS NOT NULL,
                'location', event.location,
                'price', event.price,
                'free_food', event.free_food_on_campus,
                'food', event.food,
                'description', left(event.description, 600)
            ) ORDER BY event.last_start DESC)
            FROM (
                SELECT event.*, dates.next_start, dates.last_start
                FROM public.events AS event
                CROSS JOIN LATERAL (
                    SELECT min(occurrence.dtstart_utc) FILTER (
                            WHERE occurrence.dtstart_utc > now()
                        ) AS next_start,
                        max(occurrence.dtstart_utc) AS last_start
                    FROM public.event_dates AS occurrence
                    WHERE occurrence.event_id = event.id
                ) AS dates
                WHERE (event.club_id = club.id OR club.id = ANY (event.cohost_club_ids))
                    AND NOT event.cancelled
                    AND dates.last_start IS NOT NULL
                ORDER BY dates.last_start DESC
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
WHERE pitch_fit IS NOT NULL;

NOTIFY pgrst, 'reload schema';

COMMIT;
