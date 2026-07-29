-- Deterministic, production-scale local data for API and query profiling.
-- Current production cardinalities at creation: 398 Waterloo organizations,
-- 117 Waterloo events in total, and 45 upcoming Waterloo events.

BEGIN;

UPDATE public.schools
SET
    name = 'University of Waterloo',
    timezone = 'America/Toronto',
    recipient_id = '76214170483',
    primary_color = '#FFD54F',
    secondary_color = '#111111'
WHERE slug = 'uwaterloo';

UPDATE public.schools
SET
    semester_start = '2026-05-01',
    semester_end = '2026-08-31';

WITH organization_seed AS (
    SELECT
        ordinal,
        CASE ordinal
            WHEN 1 THEN 'UW Board Games Organization'
            WHEN 2 THEN 'UW Computer Science Organization'
            WHEN 3 THEN 'Pre-Pharmacy, UW'
            WHEN 4 THEN 'UW Music Society'
            WHEN 5 THEN 'UW Intramurals'
            ELSE format('Waterloo Student Organization %s', lpad(ordinal::text, 3, '0'))
        END AS organization_name,
        CASE ordinal % 5
            WHEN 0 THEN 'wusa'
            WHEN 1 THEN 'independent'
            WHEN 2 THEN 'faculty-society'
            WHEN 3 THEN 'student-service'
            ELSE 'academic'
        END AS organization_type
    FROM generate_series(1, 398) AS ordinal
)
INSERT INTO public.organizations (
    organization_name,
    categories,
    organization_page,
    ig,
    logo_url,
    school,
    organization_type,
    status
)
SELECT
    organization_seed.organization_name,
    jsonb_build_array(
        (
            ARRAY[
                'Arts & Culture',
                'Business',
                'Community Service',
                'Environment',
                'Games & Recreation',
                'Health',
                'Media & Web',
                'Politics & Advocacy',
                'Religion & Spirituality'
            ]
        )[((organization_seed.ordinal - 1) % 9) + 1]
    ),
    format(
        'https://wat2do.local/organizations/%s',
        lpad(organization_seed.ordinal::text, 3, '0')
    ),
    format('waterlooorg%s', lpad(organization_seed.ordinal::text, 3, '0')),
    format(
        'https://picsum.photos/seed/wat2do-local-org-%s/512/512',
        organization_seed.ordinal
    ),
    'uwaterloo',
    organization_seed.organization_type,
    'approved'
FROM organization_seed
WHERE NOT EXISTS (
    SELECT 1
    FROM public.organizations existing
    WHERE existing.school = 'uwaterloo'
      AND existing.organization_name = organization_seed.organization_name
);

UPDATE public.events AS event
SET
    organization_id = organization.id,
    source_image_url = format(
        'https://picsum.photos/seed/wat2do-local-event-%s/1200/630',
        substring(event.source_url FROM '/([0-9]{3})$')
    ),
    ingestion_source = 'seed'
FROM public.organizations AS organization
WHERE event.school = 'uwaterloo'
  AND event.source_url LIKE 'https://wat2do.io/mock-events/%'
  AND organization.school = 'uwaterloo'
  AND organization.organization_name = event.organization;

UPDATE public.event_dates AS event_date
SET
    dtstart_utc = (
        date_trunc('day', now() AT TIME ZONE 'America/Toronto')
        - make_interval(days => substring(event.source_url FROM '/([0-9]{3})$')::integer - 40)
        + interval '18 hours'
    ) AT TIME ZONE 'America/Toronto',
    dtend_utc = (
        date_trunc('day', now() AT TIME ZONE 'America/Toronto')
        - make_interval(days => substring(event.source_url FROM '/([0-9]{3})$')::integer - 40)
        + interval '20 hours'
    ) AT TIME ZONE 'America/Toronto'
FROM public.events AS event
WHERE event.id = event_date.event_id
  AND event.source_url IN (
      'https://wat2do.io/mock-events/046',
      'https://wat2do.io/mock-events/047',
      'https://wat2do.io/mock-events/048',
      'https://wat2do.io/mock-events/049',
      'https://wat2do.io/mock-events/050'
  );

WITH historical_seed AS (
    SELECT
        ordinal,
        format('Historical Waterloo Event %s', lpad(ordinal::text, 3, '0')) AS title,
        format(
            'Synthetic historical event %s for local query profiling.',
            ordinal
        ) AS description,
        (
            ARRAY[
                'Student Life Centre',
                'Dana Porter Library',
                'Engineering 5',
                'Mathematics 3',
                'Federation Hall',
                'Physical Activities Complex',
                'Environment 3',
                'Hagey Hall'
            ]
        )[((ordinal - 1) % 8) + 1] AS location,
        (
            ARRAY[
                'Arts & Culture',
                'Business',
                'Community Service',
                'Environment',
                'Games & Recreation',
                'Health',
                'Media & Web',
                'Politics & Advocacy',
                'Religion & Spirituality'
            ]
        )[((ordinal - 1) % 9) + 1] AS category,
        format('https://wat2do.local/seed/events/%s', lpad(ordinal::text, 3, '0')) AS source_url,
        (
            date_trunc('day', now() AT TIME ZONE 'America/Toronto')
            - make_interval(days => ordinal + 10)
            + make_interval(hours => 9 + (ordinal % 8))
        ) AT TIME ZONE 'America/Toronto' AS dtstart_utc
    FROM generate_series(1, 67) AS ordinal
),
resolved_seed AS (
    SELECT
        historical_seed.*,
        organization.id AS organization_id,
        organization.organization_name
    FROM historical_seed
    JOIN public.organizations AS organization
      ON organization.school = 'uwaterloo'
     AND organization.organization_name = format(
         'Waterloo Student Organization %s',
         lpad((((historical_seed.ordinal - 1) % 393) + 6)::text, 3, '0')
     )
),
inserted_events AS (
    INSERT INTO public.events (
        title,
        description,
        location,
        price,
        food,
        registration,
        source_image_url,
        school,
        source_url,
        category,
        organization,
        ig_handle,
        display_handle,
        added_at,
        organization_id,
        ingestion_source
    )
    SELECT
        resolved_seed.title,
        resolved_seed.description,
        resolved_seed.location,
        CASE WHEN resolved_seed.ordinal % 4 = 0 THEN 10 ELSE 0 END,
        CASE resolved_seed.ordinal % 4
            WHEN 0 THEN NULL
            WHEN 1 THEN '["Pizza"]'::jsonb
            WHEN 2 THEN '["Coffee", "Cookies"]'::jsonb
            ELSE '["Snacks"]'::jsonb
        END,
        resolved_seed.ordinal % 3 = 0,
        format(
            'https://picsum.photos/seed/wat2do-local-history-%s/1200/630',
            resolved_seed.ordinal
        ),
        'uwaterloo',
        resolved_seed.source_url,
        resolved_seed.category,
        resolved_seed.organization_name,
        format('waterlooorg%s', lpad((((resolved_seed.ordinal - 1) % 393) + 6)::text, 3, '0')),
        format('@waterlooorg%s', lpad((((resolved_seed.ordinal - 1) % 393) + 6)::text, 3, '0')),
        now() - make_interval(days => resolved_seed.ordinal % 90),
        resolved_seed.organization_id,
        'seed'
    FROM resolved_seed
    WHERE NOT EXISTS (
        SELECT 1
        FROM public.events existing
        WHERE existing.source_url = resolved_seed.source_url
    )
    RETURNING id, source_url
),
resolved_events AS (
    SELECT event.id, event.source_url
    FROM public.events AS event
    JOIN historical_seed ON historical_seed.source_url = event.source_url

    UNION ALL

    SELECT inserted_events.id, inserted_events.source_url
    FROM inserted_events
),
scheduled_events AS (
    SELECT
        resolved_events.id AS event_id,
        historical_seed.dtstart_utc,
        historical_seed.dtstart_utc + interval '2 hours' AS dtend_utc
    FROM resolved_events
    JOIN historical_seed ON historical_seed.source_url = resolved_events.source_url
)
INSERT INTO public.event_dates (event_id, dtstart_utc, dtend_utc, tz)
SELECT
    scheduled_events.event_id,
    scheduled_events.dtstart_utc,
    scheduled_events.dtend_utc,
    'America/Toronto'
FROM scheduled_events
WHERE NOT EXISTS (
    SELECT 1
    FROM public.event_dates existing
    WHERE existing.event_id = scheduled_events.event_id
);

ANALYZE public.organizations;
ANALYZE public.events;
ANALYZE public.event_dates;

COMMIT;
