-- Backfill events.organization_id for scraped rows that already have a
-- matching organizations row (by IG handle, then unique school+name).
-- Does not invent organizations; only links existing ones.
-- When multiple orgs share an IG / normalized name, pick the lowest id.

-- Pass 1: null-org events with ig_handle → organizations.ig (case-insensitive trim).
UPDATE public.events e
SET organization_id = matched.org_id
FROM (
    SELECT DISTINCT ON (lower(trim(both from o.ig)))
        lower(trim(both from o.ig)) AS ig_key,
        o.id AS org_id
    FROM public.organizations o
    WHERE o.ig IS NOT NULL
      AND trim(both from o.ig) <> ''
    ORDER BY lower(trim(both from o.ig)), o.id ASC
) AS matched
WHERE e.organization_id IS NULL
  AND e.ig_handle IS NOT NULL
  AND trim(both from e.ig_handle) <> ''
  AND lower(trim(both from e.ig_handle)) = matched.ig_key;

-- Pass 2: remaining null-org events with non-empty organization text matched
-- to a unique (school, normalized organization_name) organization.
UPDATE public.events e
SET organization_id = matched.org_id
FROM (
    SELECT
        e2.id AS event_id,
        min(o.id) AS org_id
    FROM public.events e2
    INNER JOIN public.organizations o
        ON o.school = e2.school
       AND lower(regexp_replace(trim(both from o.organization_name), '\s+', ' ', 'g'))
         = lower(regexp_replace(trim(both from e2.organization), '\s+', ' ', 'g'))
    WHERE e2.organization_id IS NULL
      AND e2.school IS NOT NULL
      AND trim(both from e2.school) <> ''
      AND e2.organization IS NOT NULL
      AND trim(both from e2.organization) <> ''
    GROUP BY e2.id
    HAVING count(*) = 1
) AS matched
WHERE e.id = matched.event_id
  AND e.organization_id IS NULL;
