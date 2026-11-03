-- Each outreach lead gets a formality score out of 100: how official the club looks,
-- from signals the daily sweep already read (services/outreach/formality.py). The
-- admin page sorts by it and lists the signals behind it.

BEGIN;

ALTER TABLE public.outreach_leads
    -- Null until the sweep scores the lead, and again once research finds its email.
    ADD COLUMN formality smallint CHECK (formality BETWEEN 0 AND 100),
    ADD COLUMN formality_signals text[] NOT NULL DEFAULT '{}';

CREATE INDEX outreach_leads_formality_idx
    ON public.outreach_leads (status, formality DESC NULLS LAST, id) WHERE email IS NOT NULL;
CREATE INDEX outreach_leads_unscored_idx
    ON public.outreach_leads (searched_at) WHERE formality IS NULL;

-- What the formality score reads for leads not scored yet: the club, its email, its
-- listings, how many clubs share its page's host, and its school's email domains.
CREATE FUNCTION public.outreach_unscored(p_limit integer)
RETURNS TABLE (
    lead_id uuid, club_id integer, club_name text, ig text, club_page text, email text,
    listings bigint, page_host_clubs bigint, school_domains text[]
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    WITH pending AS (
        SELECT lead.id, lead.club_id, lead.email
        FROM public.outreach_leads AS lead
        WHERE lead.formality IS NULL
        ORDER BY lead.searched_at, lead.id
        LIMIT p_limit
    ),
    hosts AS (
        SELECT lower(split_part(regexp_replace(club.club_page, '^https?://(www\.)?', ''), '/', 1))
                AS host,
            count(*) AS clubs
        FROM public.clubs AS club
        WHERE club.club_page ~ '^https?://'
        GROUP BY 1
    ),
    counts AS (
        SELECT * FROM public.club_listing_counts((SELECT array_agg(club_id) FROM pending))
    )
    SELECT pending.id, club.id, club.club_name::text, club.ig::text, club.club_page::text,
        pending.email, coalesce(counts.listings, 0), coalesce(hosts.clubs, 0),
        ARRAY(
            SELECT domain.domain::text FROM public.school_email_domains AS domain
            WHERE domain.school_id = club.school_id
        )
    FROM pending
    JOIN public.clubs AS club ON club.id = pending.club_id
    LEFT JOIN counts ON counts.club_id = club.id
    LEFT JOIN hosts ON hosts.host
        = lower(split_part(regexp_replace(club.club_page, '^https?://(www\.)?', ''), '/', 1));
$$;
REVOKE ALL ON FUNCTION public.outreach_unscored(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.outreach_unscored(integer) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
