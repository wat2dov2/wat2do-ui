-- Outreach now invites clubs to claim the page Wat2Do already made for them.
--
-- Each lead is one unclaimed club with events or positions listed, and the email it
-- publishes, found on its own club page or, failing that, by a research agent. The
-- email, follow-up and claim link are written from the club at read time, so they
-- always match the club's current page.
--
-- Earlier leads were organizers of single events. Those whose organization is a club
-- we list carry over with their email, status and notes; the rest leave, since there
-- is no page for them to claim.

BEGIN;

-- An earlier organizer carries over to the club whose name makes up most of its
-- name, ignoring case and punctuation; a club named only for the school never counts.
CREATE TEMP TABLE outreach_carried_over ON COMMIT DROP AS
WITH names AS (
    SELECT lead.id AS lead_id, club.id AS club_id, lead.email, lead.source_url, lead.found_at,
        lead.status, lead.notes,
        regexp_replace(lower(lead.organization), '[^a-z0-9]+', '', 'g') AS organizer,
        regexp_replace(lower(club.club_name), '[^a-z0-9]+', '', 'g') AS club,
        regexp_replace(lower(school.name), '[^a-z0-9]+', '', 'g') AS school
    FROM public.outreach_leads AS lead
    JOIN public.clubs AS club ON club.school_id = lead.school_id
    JOIN public.schools AS school ON school.id = lead.school_id
),
matches AS (
    SELECT DISTINCT ON (lead_id) *
    FROM names
    WHERE length(club) >= 6
        AND organizer LIKE '%' || club || '%'
        AND length(club) * 10 >= length(organizer) * 4
        AND position(club IN school) = 0
    ORDER BY lead_id, length(club) DESC
)
SELECT DISTINCT ON (club_id)
    club_id, email, source_url, found_at,
    CASE WHEN status = 'submitted' THEN 'claimed' ELSE status END AS status, notes
FROM matches
ORDER BY club_id, found_at;

DROP TABLE public.outreach_leads;

CREATE TABLE public.outreach_leads (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id integer NOT NULL UNIQUE REFERENCES public.clubs(id) ON DELETE CASCADE,
    -- Null until the club's email is found; the sweep keeps looking.
    email text CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
    -- The public page the email is printed on.
    email_source_url text CHECK (email_source_url ~ '^https://'),
    email_found_by text CHECK (email_found_by IN ('club_page', 'research')),
    -- When the club's own page was read, and when an agent last searched the web.
    searched_at timestamptz NOT NULL DEFAULT now(),
    researched_at timestamptz,
    status text NOT NULL DEFAULT 'new'
        CHECK (status IN ('new', 'contacted', 'replied', 'claimed', 'not_interested', 'dismissed')),
    notes text NOT NULL DEFAULT '',
    found_at timestamptz,
    CHECK (
        (email IS NULL AND email_source_url IS NULL AND email_found_by IS NULL AND found_at IS NULL)
        OR (email IS NOT NULL AND email_source_url IS NOT NULL AND email_found_by IS NOT NULL
            AND found_at IS NOT NULL)
    )
);
CREATE INDEX outreach_leads_review_idx
    ON public.outreach_leads (status, found_at DESC, id) WHERE email IS NOT NULL;
CREATE INDEX outreach_leads_email_idx ON public.outreach_leads (email) WHERE email IS NOT NULL;
CREATE INDEX outreach_leads_research_idx
    ON public.outreach_leads (researched_at NULLS FIRST, searched_at) WHERE email IS NULL;

INSERT INTO public.outreach_leads
    (club_id, email, email_source_url, email_found_by, searched_at, researched_at,
     status, notes, found_at)
SELECT club_id, email, source_url, 'research', found_at, found_at, status, notes, found_at
FROM outreach_carried_over;

ALTER TABLE public.outreach_leads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.outreach_leads FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.outreach_leads TO service_role;

-- Clubs nobody has claimed yet: no creator and no members.
CREATE FUNCTION public.outreach_unclaimed(p_club_ids integer[])
RETURNS SETOF integer
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT club.id
    FROM public.clubs AS club
    WHERE club.id = ANY (p_club_ids)
        AND club.created_by IS NULL
        AND NOT EXISTS (SELECT 1 FROM public.club_members AS member WHERE member.club_id = club.id);
$$;
REVOKE ALL ON FUNCTION public.outreach_unclaimed(integer[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.outreach_unclaimed(integer[]) TO service_role;

-- Every event (as host or cohost) and position each club has listed.
CREATE FUNCTION public.club_listing_counts(p_club_ids integer[] DEFAULT NULL)
RETURNS TABLE (club_id integer, listings bigint)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT listed.club_id, count(*)
    FROM (
        SELECT event.club_id FROM public.events AS event WHERE event.club_id IS NOT NULL
        UNION ALL
        SELECT unnest(event.cohost_club_ids) FROM public.events AS event
        UNION ALL
        SELECT position.club_id FROM public.positions AS position
        WHERE position.club_id IS NOT NULL
    ) AS listed
    WHERE p_club_ids IS NULL OR listed.club_id = ANY (p_club_ids)
    GROUP BY listed.club_id;
$$;
REVOKE ALL ON FUNCTION public.club_listing_counts(integer[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.club_listing_counts(integer[]) TO service_role;

-- Approved, unclaimed clubs with at least one listing and no lead yet, busiest first:
-- those have the most on their page to show.
CREATE FUNCTION public.outreach_new_clubs(p_limit integer)
RETURNS TABLE (club_id integer, club_page text, listings bigint)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT club.id, club.club_page::text, listing.listings
    FROM public.club_listing_counts() AS listing
    JOIN public.clubs AS club ON club.id = listing.club_id
    WHERE club.status = 'approved'
        AND club.created_by IS NULL
        AND NOT EXISTS (SELECT 1 FROM public.club_members AS member WHERE member.club_id = club.id)
        AND NOT EXISTS (SELECT 1 FROM public.outreach_leads AS lead WHERE lead.club_id = club.id)
    ORDER BY listing.listings DESC, club.id
    LIMIT p_limit;
$$;
REVOKE ALL ON FUNCTION public.outreach_new_clubs(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.outreach_new_clubs(integer) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
