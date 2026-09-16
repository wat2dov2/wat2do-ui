-- Deterministic, production-scale local data for API and query profiling.
-- Current production cardinalities at creation: 398 Waterloo clubs,
-- 117 Waterloo events in total, and 45 upcoming Waterloo events.

BEGIN;

UPDATE public.schools SET language = 'fr' WHERE slug = 'ulaval';

UPDATE public.schools
SET location_examples = examples.locations
FROM (VALUES
    ('uwaterloo', ARRAY['MC', 'SLC']::text[]),
    ('ualberta', ARRAY['Students Union Building', 'Cameron Library']::text[]),
    ('ulaval', ARRAY['Pavillon Alphonse-Desjardins', 'PEPS']::text[])
) AS examples(slug, locations)
WHERE schools.slug = examples.slug;

UPDATE public.schools
SET
    name = 'University of Waterloo',
    timezone = 'America/Toronto',
    language = 'en',
    faculties = ARRAY['Arts', 'Engineering', 'Environment', 'Health', 'Mathematics', 'Science'],
    recipient_id = '76214170483',
    primary_color = '#000000',
    secondary_color = '#FED34C'
WHERE slug = 'uwaterloo';

UPDATE public.site_banner
SET
    message_translation_key = 'siteBanner.founderStory.message',
    cta_label_translation_key = 'siteBanner.founderStory.cta',
    cta_href = '/contact',
    updated_at = now()
WHERE id = 1;

WITH club_seed AS (
    SELECT
        ordinal,
        CASE ordinal
            WHEN 1 THEN 'UW Board Games Club'
            WHEN 2 THEN 'UW Computer Science Club'
            WHEN 3 THEN 'Pre-Pharmacy, UW'
            WHEN 4 THEN 'UW Music Society'
            WHEN 5 THEN 'UW Intramurals'
            ELSE format('Waterloo Student Club %s', lpad(ordinal::text, 3, '0'))
        END AS club_name,
        CASE ordinal % 5
            WHEN 0 THEN 'wusa'
            WHEN 1 THEN 'independent'
            WHEN 2 THEN 'faculty-society'
            WHEN 3 THEN 'student-service'
            ELSE 'academic'
        END AS club_type
    FROM generate_series(1, 398) AS ordinal
)
INSERT INTO public.clubs (
    club_name,
    categories,
    club_page,
    ig,
    logo_url,
    school_id,
    club_type,
    status
)
SELECT
    club_seed.club_name,
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
        )[((club_seed.ordinal - 1) % 9) + 1]
    ),
    format(
        'https://wat2do.local/clubs/%s',
        lpad(club_seed.ordinal::text, 3, '0')
    ),
    format('waterlooorg%s', lpad(club_seed.ordinal::text, 3, '0')),
    format(
        'https://picsum.photos/seed/wat2do-local-org-%s/512/512',
        club_seed.ordinal
    ),
    (SELECT id FROM public.schools WHERE slug = 'uwaterloo'),
    club_seed.club_type,
    'approved'
FROM club_seed
WHERE NOT EXISTS (
    SELECT 1
    FROM public.clubs existing
    WHERE existing.school_id = (
        SELECT id FROM public.schools WHERE slug = 'uwaterloo'
    )
      AND existing.club_name = club_seed.club_name
);

UPDATE public.events AS event
SET
    club_id = club.id,
    source_image_url = format(
        'https://picsum.photos/seed/wat2do-local-event-%s/1200/630',
        substring(event.source_url FROM '/([0-9]{3})$')
    ),
    ingestion_source = 'seed'
FROM public.clubs AS club
WHERE event.school_id = (
        SELECT id FROM public.schools WHERE slug = 'uwaterloo'
    )
  AND event.source_url LIKE 'https://wat2do.io/mock-events/%'
  AND club.school_id = (
        SELECT id FROM public.schools WHERE slug = 'uwaterloo'
    )
  AND club.club_name = event.club;

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
        club.id AS club_id,
        club.club_name
    FROM historical_seed
    JOIN public.clubs AS club
      ON club.school_id = (
          SELECT id FROM public.schools WHERE slug = 'uwaterloo'
      )
     AND club.club_name = format(
         'Waterloo Student Club %s',
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
        school_id,
        source_url,
        category,
        club,
        ig_handle,
        display_handle,
        added_at,
        club_id,
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
        (SELECT id FROM public.schools WHERE slug = 'uwaterloo'),
        resolved_seed.source_url,
        resolved_seed.category,
        resolved_seed.club_name,
        format('waterlooorg%s', lpad((((resolved_seed.ordinal - 1) % 393) + 6)::text, 3, '0')),
        format('@waterlooorg%s', lpad((((resolved_seed.ordinal - 1) % 393) + 6)::text, 3, '0')),
        now() - make_interval(days => resolved_seed.ordinal % 90),
        resolved_seed.club_id,
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

-- BEGIN hourly school mock events (local seed only).
WITH hourly_seed AS (
    SELECT
        slot, school.slug, school.timezone,
        date_trunc('day', now() AT TIME ZONE school.timezone)
            + make_interval(hours => slot) AS local_start,
        school.id AS school_id,
        (SELECT id FROM public.clubs WHERE school_id = school.id ORDER BY id LIMIT 1) AS club_id
    FROM public.schools school
    CROSS JOIN generate_series(0, 47) AS slot
    WHERE school.slug IN ('uwaterloo', 'ualberta', 'ulaval')
), prepared AS (
    SELECT *,
        format('https://wat2do.local/seed/hourly/%s%s',
            CASE WHEN slug = 'uwaterloo' THEN '' ELSE slug || '/' END,
            to_char(local_start, 'YYYY-MM-DD-HH24')) AS source_url
    FROM hourly_seed
), inserted AS (
    INSERT INTO public.events (
        title, description, location, price, food, registration,
        source_image_url, school_id, source_url, category, club, club_id,
        added_at, ingestion_source
    )
    SELECT
        format('%s Mock %s - %s', CASE slug WHEN 'uwaterloo' THEN 'Waterloo' WHEN 'ualberta' THEN 'Alberta' ELSE 'ULaval' END,
            to_char(local_start, 'Mon DD HH24:MI'),
            (ARRAY['Study Social', 'Board Games', 'Coffee Meetup', 'Campus Workshop'])[slot % 4 + 1]),
        format('Synthetic local event for calendar and filter testing. Expected school-local start: %s (%s).',
            to_char(local_start, 'YYYY-MM-DD HH24:MI'), timezone),
        CASE WHEN slug = 'uwaterloo'
            THEN (ARRAY['Student Life Centre', 'Dana Porter Library', 'Engineering 5', 'Mathematics 3'])[slot % 4 + 1]
            WHEN slug = 'ualberta' THEN (ARRAY['Students Union Building', 'Cameron Library', 'CAB', 'Van Vliet Centre'])[slot % 4 + 1]
            ELSE (ARRAY['Pavillon Alphonse-Desjardins', 'Pavillon Jean-Charles-Bonenfant', 'PEPS', 'Pavillon Maurice-Pollack'])[slot % 4 + 1]
        END,
        CASE WHEN slot % 4 IN (2, 3) THEN 5 ELSE 0 END,
        CASE WHEN slot % 2 = 0 THEN '["Pizza", "Snacks"]'::jsonb ELSE '[]'::jsonb END,
        slot % 3 = 0,
        format('https://picsum.photos/seed/wat2do-hourly-%s/1200/630', slot),
        school_id, source_url,
        (ARRAY['Games & Recreation', 'Arts & Culture', 'Business', 'Health'])[slot % 4 + 1],
        coalesce((SELECT club_name FROM public.clubs WHERE id = prepared.club_id), 'Local campus events'),
        club_id, now() - make_interval(hours => slot % 36), 'seed'
    FROM prepared
    WHERE NOT EXISTS (SELECT 1 FROM public.events e WHERE e.source_url = prepared.source_url)
    RETURNING id, source_url
), resolved AS (
    SELECT id, source_url FROM inserted
    UNION ALL
    SELECT e.id, e.source_url FROM public.events e JOIN prepared p USING (source_url)
)
INSERT INTO public.event_dates (event_id, dtstart_utc, dtend_utc, tz)
SELECT r.id,
    p.local_start AT TIME ZONE p.timezone,
    (p.local_start + interval '1 hour') AT TIME ZONE p.timezone,
    p.timezone
FROM resolved r JOIN prepared p USING (source_url)
WHERE NOT EXISTS (SELECT 1 FROM public.event_dates d WHERE d.event_id = r.id);
-- END hourly school mock events.

-- Paid, unpaid, and unspecified roles exercise filters without guessing from text.
INSERT INTO public.positions (
    club_id, school_id, title, description, position_type,
    is_paid, compensation, source_url, ingestion_source, deadline_date
)
SELECT club.id, club.school_id, role.title,
    'Help organize campus activities and support the club team.', role.position_type,
    role.is_paid, role.compensation, role.source_url, 'seed', current_date + 30
FROM public.clubs club
CROSS JOIN (VALUES
    ('Paid Program Assistant', 'staff', true, '$20/hour', 'https://example.com/positions/paid'),
    ('Volunteer Coordinator', 'volunteer', false, 'Unpaid', 'https://example.com/positions/unpaid'),
    ('Design Lead', 'committee', NULL, NULL, 'https://example.com/positions/unknown')
) AS role(title, position_type, is_paid, compensation, source_url)
WHERE club.club_name = 'UW Board Games Club'
ON CONFLICT DO NOTHING;

-- Enough Waterloo roles to exercise scrolling and position-type/paid filters.
INSERT INTO public.positions (
    club_id, school_id, title, description, position_type, is_paid,
    compensation, location, source_url, ingestion_source, deadline_date
)
SELECT club.id, club.school_id,
    format('Waterloo Demo %s - %s', slot,
        (ARRAY['Program Assistant', 'Outreach Coordinator', 'Design Lead', 'Research Intern'])[1 + (slot - 1) % 4]),
    'Synthetic local position for testing sticky listing controls, scrolling, search, and filters.',
    (ARRAY['staff', 'volunteer', 'committee', 'internship'])[1 + (slot - 1) % 4],
    slot % 2 = 0,
    CASE WHEN slot % 2 = 0 THEN '$20/hour' ELSE 'Unpaid' END,
    'University of Waterloo',
    format('https://wat2do.local/seed/positions/waterloo/%s', slot),
    'seed', current_date + 30
FROM public.clubs club
CROSS JOIN generate_series(1, 40) AS slot
WHERE club.club_name = 'UW Board Games Club'
  AND club.school_id = (SELECT id FROM public.schools WHERE slug = 'uwaterloo')
  AND NOT EXISTS (
      SELECT 1 FROM public.positions existing
      WHERE existing.source_url = format('https://wat2do.local/seed/positions/waterloo/%s', slot)
  )
ON CONFLICT DO NOTHING;

INSERT INTO public.position_submissions (id, school_id, position_data)
SELECT '00000000-0000-4000-9000-000000000001'::uuid, club.school_id,
    jsonb_build_object('club_id', club.id, 'title', 'Pending Outreach Lead',
        'description', 'Coordinate outreach activities for the club.', 'position_type', 'executive',
        'is_paid', false, 'source_url', 'https://example.com/positions/pending')
FROM public.clubs club
WHERE club.club_name = 'UW Board Games Club'
ON CONFLICT DO NOTHING;

-- Local Instagram review fixtures. Only newly created batches receive items,
-- so rerunning this seed preserves carousel edits made through the admin UI.
-- The deliberately fake Instagram ID cannot match real publishing credentials.
WITH scenarios(day_offset, status, error_message) AS (
    VALUES
        (0, 'ready_for_review', NULL::text),
        (1, 'ready_for_review', NULL::text),
        (2, 'failed',
            'Simulated local failure: Instagram session expired. No publishing was attempted.')
), new_batches AS (
    INSERT INTO public.instagram_publish_batches (
        account_key, instagram_user_id, school_id, local_date,
        window_start, window_end, status, caption, caption_intro, cover_body,
        error_message
    )
    SELECT school.slug, 'local-seed-not-a-meta-account', school.id,
        (now() AT TIME ZONE school.timezone)::date - scenario.day_offset,
        now() - make_interval(days => scenario.day_offset + 1),
        now() - make_interval(days => scenario.day_offset),
        scenario.status,
        CASE WHEN school.slug = 'ulaval' THEN 'Aperçu local des événements à ULaval' ELSE intro.value END,
        CASE WHEN school.slug = 'ulaval' THEN 'Aperçu local des événements à ULaval' ELSE intro.value END,
        '', scenario.error_message
    FROM public.schools school
    CROSS JOIN scenarios scenario
    CROSS JOIN (VALUES ('Fresh events at uwaterloo, added to Wat2Do in the last 24 hours 👀')) AS intro(value)
    WHERE school.slug IN ('uwaterloo', 'ulaval')
      AND (school.slug = 'uwaterloo' OR scenario.day_offset = 0)
    ON CONFLICT (account_key, local_date) DO NOTHING
    RETURNING id, account_key, school_id
), candidates AS (
    SELECT event.id, event.school_id,
        row_number() OVER (PARTITION BY event.school_id ORDER BY min(occurrence.dtstart_utc), event.id) AS position
    FROM public.events event
    JOIN public.event_dates occurrence ON occurrence.event_id = event.id
    WHERE event.source_url LIKE 'https://wat2do.local/seed/hourly/%'
      AND event.school_id IN (SELECT id FROM public.schools WHERE slug IN ('uwaterloo', 'ulaval'))
      AND occurrence.dtstart_utc > now()
      AND coalesce(event.source_image_url, '') <> ''
    GROUP BY event.id, event.school_id
)
INSERT INTO public.instagram_publish_items (batch_id, account_key, event_id, position)
SELECT batch.id, batch.account_key, event.id, event.position::integer
FROM new_batches batch
JOIN candidates event ON event.school_id = batch.school_id
WHERE event.position <= 6;

-- Refresh an expired local Laval preview without replacing carousel edits.
WITH expired_batches AS (
    SELECT batch.id, batch.account_key, batch.school_id,
        coalesce((SELECT max(position) FROM public.instagram_publish_items WHERE batch_id = batch.id), 0) AS last_position
    FROM public.instagram_publish_batches batch
    JOIN public.schools school ON school.id = batch.school_id
    WHERE batch.account_key = 'ulaval'
      AND batch.instagram_user_id = 'local-seed-not-a-meta-account'
      AND batch.status = 'ready_for_review'
      AND batch.local_date = (now() AT TIME ZONE school.timezone)::date
      AND NOT EXISTS (
          SELECT 1 FROM public.instagram_publish_items item
          JOIN public.events event ON event.id = item.event_id
          JOIN public.event_dates occurrence ON occurrence.event_id = event.id
          WHERE item.batch_id = batch.id
            AND nullif(trim(event.source_image_url), '') IS NOT NULL
            AND coalesce(occurrence.dtend_utc, occurrence.dtstart_utc) > now()
      )
)
INSERT INTO public.instagram_publish_items (batch_id, account_key, event_id, position)
SELECT batch.id, batch.account_key, candidate.id,
    batch.last_position + row_number() OVER (PARTITION BY batch.id ORDER BY candidate.starts_at, candidate.id)::integer
FROM expired_batches batch
CROSS JOIN LATERAL (
    SELECT event.id, min(occurrence.dtstart_utc) AS starts_at
    FROM public.events event
    JOIN public.event_dates occurrence ON occurrence.event_id = event.id
    WHERE event.school_id = batch.school_id
      AND event.source_url LIKE 'https://wat2do.local/seed/hourly/ulaval/%'
      AND nullif(trim(event.source_image_url), '') IS NOT NULL
      AND occurrence.dtstart_utc > now()
      AND NOT EXISTS (
          SELECT 1 FROM public.instagram_publish_items item
          WHERE item.batch_id = batch.id AND item.event_id = event.id
      )
    GROUP BY event.id
    ORDER BY starts_at, event.id
    LIMIT 6
) candidate;

-- WAT-278: intentionally incorrect occurrence timezone must not override school time.
WITH prepared AS (
    SELECT school.id AS school_id, school.timezone,
        (now() AT TIME ZONE school.timezone)::date + 1 + fixture.start_time AS local_start,
        fixture.title,
        format('https://wat2do.local/seed/instagram-timezone/%s/%s',
            (now() AT TIME ZONE school.timezone)::date, fixture.slug) AS source_url
    FROM public.schools school
    CROSS JOIN (VALUES
        ('evening', time '18:00', 'WAT-278 - Edmonton 6 PM'),
        ('late-night', time '23:30', 'WAT-278 - Edmonton 11:30 PM (same day)')
    ) AS fixture(slug, start_time, title)
    WHERE school.slug = 'ualberta'
), inserted AS (
    INSERT INTO public.events (
        title, description, location, price, food, registration,
        source_image_url, school_id, source_url, category, club, added_at, ingestion_source
    )
    SELECT title,
        'WAT-278 regression fixture: Instagram output must use Edmonton school time, despite the deliberately incorrect Toronto occurrence timezone.',
        'University of Alberta', 0, '[]'::jsonb, false,
        'https://picsum.photos/seed/wat2do-timezone/1200/630',
        school_id, source_url, 'Games & Recreation', 'Local timezone test', now(), 'seed'
    FROM prepared
    WHERE NOT EXISTS (SELECT 1 FROM public.events e WHERE e.source_url = prepared.source_url)
    RETURNING id, source_url
), resolved AS (
    SELECT id, source_url FROM inserted
    UNION ALL
    SELECT e.id, e.source_url FROM public.events e JOIN prepared p USING (source_url)
)
INSERT INTO public.event_dates (event_id, dtstart_utc, dtend_utc, tz)
SELECT r.id, p.local_start AT TIME ZONE p.timezone,
    (p.local_start + interval '30 minutes') AT TIME ZONE p.timezone, 'America/Toronto'
FROM resolved r JOIN prepared p USING (source_url)
WHERE NOT EXISTS (SELECT 1 FROM public.event_dates d WHERE d.event_id = r.id);

WITH new_batches AS (
    INSERT INTO public.instagram_publish_batches (
        account_key, instagram_user_id, school_id, local_date,
        window_start, window_end, status, caption, caption_intro, cover_body
    )
    SELECT school.slug, 'local-seed-not-a-meta-account', school.id,
        (now() AT TIME ZONE school.timezone)::date,
        now() - interval '1 day', now(), 'ready_for_review',
        'WAT-278 timezone regression', 'WAT-278 timezone regression',
        'Both events should show Edmonton time: 6 PM and 11:30 PM on the same day.'
    FROM public.schools school
    WHERE school.slug = 'ualberta'
    ON CONFLICT (account_key, local_date) DO NOTHING
    RETURNING id, account_key, school_id, local_date
)
INSERT INTO public.instagram_publish_items (batch_id, account_key, event_id, position)
SELECT batch.id, batch.account_key, event.id,
    row_number() OVER (PARTITION BY batch.id ORDER BY occurrence.dtstart_utc, event.id)::integer
FROM new_batches batch
JOIN public.events event ON event.school_id = batch.school_id
JOIN public.event_dates occurrence ON occurrence.event_id = event.id
WHERE event.source_url LIKE format('https://wat2do.local/seed/instagram-timezone/%s/%%', batch.local_date);

ANALYZE public.clubs;
-- Multi-school moderation fixtures. Stable IDs preserve review decisions on reruns.
-- These synthetic users have no auth account and cannot sign in.
DO $$
BEGIN
CREATE TEMP TABLE moderation_seed ON COMMIT DROP AS
SELECT s.id AS school_id, s.slug, s.timezone, slot,
    md5('wat2do-local-moderation-user-' || s.slug || '-' || slot)::uuid AS user_id,
    format('moderation-%s-%s@example.invalid', s.slug, slot) AS email
FROM public.schools s
CROSS JOIN generate_series(1, 2) AS slot
WHERE s.slug IN ('uwaterloo', 'ualberta', 'ulaval');

INSERT INTO public.users (id, supabase_auth_id, email, full_name, school_id)
SELECT user_id, user_id::text, email,
    format('Demo %s Submitter %s', slug, slot), school_id
FROM moderation_seed
ON CONFLICT DO NOTHING;

INSERT INTO public.clubs (
    club_name, school_id, categories, club_type, status, created_by, club_page
)
SELECT format('Demo %s %s Club %s', fixture.slug, kind.label, fixture.slot),
    fixture.school_id, '["Games & Recreation"]'::jsonb, 'independent',
    kind.status, CASE WHEN kind.status = 'pending' THEN fixture.user_id END,
    format('https://example.invalid/moderation/%s/%s/%s', fixture.slug, kind.label, fixture.slot)
FROM moderation_seed fixture
CROSS JOIN (VALUES ('Submission', 'pending'), ('Claim', 'approved')) AS kind(label, status)
WHERE NOT EXISTS (
    SELECT 1 FROM public.clubs c
    WHERE c.school_id = fixture.school_id
      AND c.club_name = format('Demo %s %s Club %s', fixture.slug, kind.label, fixture.slot)
);

INSERT INTO public.club_claims (id, club_id, user_id, executive_role, proof_url, created_at)
SELECT md5('wat2do-local-claim-' || fixture.slug || '-' || fixture.slot)::uuid,
    club.id, fixture.user_id,
    CASE WHEN fixture.slot = 1 THEN 'President' ELSE 'Events Coordinator' END,
    format('https://example.invalid/moderation/%s/claim-proof/%s', fixture.slug, fixture.slot),
    now() - make_interval(mins => fixture.slot * 3)
FROM moderation_seed fixture
JOIN public.clubs club ON club.school_id = fixture.school_id
    AND club.club_name = format('Demo %s Claim Club %s', fixture.slug, fixture.slot)
ON CONFLICT DO NOTHING;

INSERT INTO public.event_submissions (id, user_id, school_id, event_data, submitted_at)
SELECT md5('wat2do-local-event-submission-' || fixture.slug || '-' || fixture.slot)::uuid,
    fixture.user_id, fixture.school_id,
    jsonb_build_object(
        'title', format('Demo %s Event Submission %s', fixture.slug, fixture.slot),
        'description', 'Synthetic local submission for testing cross-school moderation.',
        'location', format('%s Student Centre', fixture.slug),
        'club_id', club.id,
        'category', 'Games & Recreation',
        'price', 0,
        'source_url', format('https://example.invalid/moderation/%s/event/%s', fixture.slug, fixture.slot),
        'source_image_url', format('https://picsum.photos/seed/moderation-%s-%s/1080/1350', fixture.slug, fixture.slot),
        'occurrences', jsonb_build_array(jsonb_build_object(
            'dtstart_utc', now() + make_interval(days => fixture.slot + 7),
            'dtend_utc', now() + make_interval(days => fixture.slot + 7, hours => 2),
            'tz', fixture.timezone
        ))
    ), now() - make_interval(mins => fixture.slot * 2)
FROM moderation_seed fixture
JOIN public.clubs club ON club.school_id = fixture.school_id
    AND club.club_name = format('Demo %s Claim Club %s', fixture.slug, fixture.slot)
ON CONFLICT DO NOTHING;

INSERT INTO public.reported_events (id, event_id, user_id, reason, status, reported_at, resolved_at)
SELECT md5('wat2do-local-event-report-' || fixture.slug || '-' || fixture.slot)::uuid,
    event.id, fixture.user_id,
    format('Demo %s report %s: please verify the event location.', fixture.slug, fixture.slot),
    CASE WHEN fixture.slot = 1 THEN 'pending' ELSE 'resolved' END,
    now() - make_interval(mins => fixture.slot * 2),
    CASE WHEN fixture.slot = 2 THEN now() END
FROM moderation_seed fixture
JOIN LATERAL (
    SELECT id FROM public.events
    WHERE school_id = fixture.school_id AND source_url LIKE 'https://wat2do.local/seed/%'
    ORDER BY id OFFSET fixture.slot - 1 LIMIT 1
) event ON true
ON CONFLICT DO NOTHING;
END;
$$;

ANALYZE public.events;
ANALYZE public.event_dates;
ANALYZE public.positions;

COMMIT;
