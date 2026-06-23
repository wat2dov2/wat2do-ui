-- Seed 50 upcoming Waterloo mock events for feed rendering and pagination QA.
-- Production-visible seed data belongs in migrations, not backend/seeds/*.py.

BEGIN;

WITH seed_titles(ord, title) AS (
  VALUES
    (1,  'Board Game Night'),
    (2,  'Tech Career Fair'),
    (3,  'UWMUN Events'),
    (4,  'Campus Open Mic'),
    (5,  'Startup Pitch Practice'),
    (6,  'Volunteer Fair'),
    (7,  'Bike Repair Pop-Up'),
    (8,  'Chess Ladder Night'),
    (9,  'Mental Health Snack Chat'),
    (10, 'Indie Film Screening'),
    (11, 'Resume Roast Workshop'),
    (12, 'Hack Night: Tiny Tools'),
    (13, 'Beginner Salsa Social'),
    (14, 'Plant Swap'),
    (15, 'Coffee With Professors'),
    (16, 'Retro Games Tournament'),
    (17, 'Public Speaking Lab'),
    (18, 'Community Kitchen Shift'),
    (19, 'Photography Walk'),
    (20, 'Robotics Demo Day'),
    (21, 'Trivia Night'),
    (22, 'Study Jam'),
    (23, 'Financial Literacy 101'),
    (24, 'Campus Clean-Up'),
    (25, 'Yoga Reset'),
    (26, 'Creative Writing Circle'),
    (27, 'AI Reading Group'),
    (28, 'Pharmacy Mixer'),
    (29, 'Intramural Dodgeball'),
    (30, 'Design Portfolio Review'),
    (31, 'Climate Action Roundtable'),
    (32, 'Karaoke Night'),
    (33, 'Intro to Web Scraping'),
    (34, 'Board Games and Bubble Tea'),
    (35, 'Women in STEM Panel'),
    (36, 'Potluck Social'),
    (37, 'Music Theory Crash Course'),
    (38, 'Case Competition Prep'),
    (39, 'Data Visualization Workshop'),
    (40, 'Sustainability Clothing Swap'),
    (41, 'Badminton Drop-In'),
    (42, 'Campus Faith Dialogue'),
    (43, 'Entrepreneurship Coffee Chats'),
    (44, 'Dungeons and Dragons One-Shot'),
    (45, 'Public Policy Debate'),
    (46, 'Zine-Making Workshop'),
    (47, 'Health Sciences Networking'),
    (48, 'Open Source Sprint'),
    (49, 'Late-Night Pancake Study Break'),
    (50, 'End-of-Week Social')
),
seed_lists AS (
  SELECT
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
    ] AS categories,
    ARRAY[
      'UW Board Games Organization',
      'UW Computer Science Organization',
      'Pre-Pharmacy, UW',
      'UW Music Society',
      'UW Intramurals'
    ] AS organizations,
    ARRAY[
      'Student Life Centre',
      'Dana Porter Library',
      'Engineering 5',
      'Mathematics 3',
      'Federation Hall',
      'Physical Activities Complex',
      'Environment 3',
      'Hagey Hall',
      'QNC Atrium',
      'Village 1 Great Hall'
    ] AS venues
),
seed_events AS (
  SELECT
    seed_titles.ord,
    seed_titles.title,
    format(
      'A seeded upcoming campus event for testing the event feed with many cards. This one is focused on %s.',
      lower(seed_lists.categories[((seed_titles.ord - 1) % array_length(seed_lists.categories, 1)) + 1])
    ) AS description,
    seed_lists.venues[((seed_titles.ord - 1) % array_length(seed_lists.venues, 1)) + 1] AS location,
    CASE WHEN (seed_titles.ord - 1) % 4 = 0 THEN 5 ELSE 0 END::double precision AS price,
    CASE (seed_titles.ord - 1) % 6
      WHEN 0 THEN NULL::jsonb
      WHEN 1 THEN '["Pizza"]'::jsonb
      WHEN 2 THEN '["Bubble tea"]'::jsonb
      WHEN 3 THEN '["Coffee", "Cookies"]'::jsonb
      WHEN 4 THEN '["Fruit", "Granola bars"]'::jsonb
      ELSE '["Pancakes"]'::jsonb
    END AS food,
    ((seed_titles.ord - 1) % 5 = 0) AS registration,
    seed_lists.categories[((seed_titles.ord - 1) % array_length(seed_lists.categories, 1)) + 1] AS category,
    seed_lists.organizations[((seed_titles.ord - 1) % array_length(seed_lists.organizations, 1)) + 1] AS organization,
    lower(replace(seed_lists.organizations[((seed_titles.ord - 1) % array_length(seed_lists.organizations, 1)) + 1], ' ', '')) AS ig_handle,
    format('https://wat2do.io/mock-events/%s', lpad(seed_titles.ord::text, 3, '0')) AS source_url,
    (
      date_trunc('day', now() AT TIME ZONE 'America/Toronto')
      + make_interval(
          days => 9 + seed_titles.ord,
          hours => 9 + ((seed_titles.ord - 1) % 8),
          mins => CASE WHEN (seed_titles.ord - 1) % 3 = 0 THEN 30 ELSE 0 END
        )
    ) AT TIME ZONE 'America/Toronto' AS dtstart_utc,
    make_interval(hours => 1 + ((seed_titles.ord - 1) % 3)) AS duration
  FROM seed_titles
  CROSS JOIN seed_lists
),
existing_seed_events AS (
  SELECT DISTINCT ON (seed_events.source_url)
    existing.id,
    seed_events.source_url
  FROM seed_events
  JOIN public.events existing
    ON existing.source_url = seed_events.source_url
    OR (
      existing.title = seed_events.title
      AND existing.description = seed_events.description
    )
  ORDER BY seed_events.source_url, existing.id
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
    source_url,
    category,
    organization,
    organization_type,
    school,
    ig_handle
  )
  SELECT
    seed_events.title,
    seed_events.description,
    seed_events.location,
    seed_events.price,
    seed_events.food,
    seed_events.registration,
    NULL,
    seed_events.source_url,
    seed_events.category,
    seed_events.organization,
    'WUSA',
    'uwaterloo',
    seed_events.ig_handle
  FROM seed_events
  WHERE NOT EXISTS (
    SELECT 1
    FROM existing_seed_events existing
    WHERE existing.source_url = seed_events.source_url
  )
  RETURNING id, source_url
),
resolved_events AS (
  SELECT id, source_url
  FROM existing_seed_events
  UNION ALL
  SELECT id, source_url
  FROM inserted_events
),
scheduled_events AS (
  SELECT
    resolved_events.id,
    seed_events.dtstart_utc,
    seed_events.dtstart_utc + seed_events.duration AS dtend_utc
  FROM resolved_events
  JOIN seed_events ON seed_events.source_url = resolved_events.source_url
)
INSERT INTO public.event_dates (event_id, dtstart_utc, dtend_utc, tz)
SELECT
  scheduled_events.id,
  scheduled_events.dtstart_utc,
  scheduled_events.dtend_utc,
  'America/Toronto'
FROM scheduled_events
WHERE NOT EXISTS (
  SELECT 1
  FROM public.event_dates existing_date
  WHERE existing_date.event_id = scheduled_events.id
);

NOTIFY pgrst, 'reload schema';

COMMIT;
