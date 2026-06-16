-- Align category filters with the master spreadsheet categories (9 canonical categories).

BEGIN;

-- 1. Drop check constraint on events.category to allow mapping
ALTER TABLE public.events DROP CONSTRAINT IF EXISTS chk_events_category_valid;

CREATE TEMP TABLE category_map (
  old_category text PRIMARY KEY,
  new_category text NOT NULL
);

INSERT INTO category_map (old_category, new_category) VALUES
  ('Academics', 'Business'),
  ('Academic', 'Business'),
  ('Studying', 'Business'),
  ('Career', 'Business'),
  ('Networking', 'Business'),
  ('Entrepreneurship', 'Business'),
  ('Volunteering', 'Community Service'),
  ('Art', 'Arts & Culture'),
  ('Dance', 'Arts & Culture'),
  ('dance', 'Arts & Culture'),
  ('Culture', 'Arts & Culture'),
  ('Cultural', 'Arts & Culture'),
  ('Music', 'Arts & Culture'),
  ('music', 'Arts & Culture'),
  ('Food', 'Arts & Culture'),
  ('Games', 'Games & Recreation'),
  ('Gaming', 'Games & Recreation'),
  ('gaming', 'Games & Recreation'),
  ('esports', 'Games & Recreation'),
  ('Social & Games', 'Games & Recreation'),
  ('Partying', 'Games & Recreation'),
  ('Athletics', 'Games & Recreation'),
  ('Sports', 'Games & Recreation'),
  ('Technology', 'Media & Web'),
  ('AI', 'Media & Web'),
  ('Design', 'Media & Web'),
  ('design', 'Media & Web'),
  ('hackathons', 'Media & Web'),
  ('Advocacy', 'Politics & Advocacy'),
  ('Religion', 'Religion & Spirituality'),
  ('Religious', 'Religion & Spirituality'),
  ('Health', 'Health'),
  ('Wellness', 'Health'),
  ('Mental Health', 'Health');

-- 2. Update public.events.category
UPDATE public.events
SET category = COALESCE(category_map.new_category, events.category)
FROM category_map
WHERE events.category = category_map.old_category;

-- 3. Update public.organizations.categories (jsonb array)
WITH remapped AS (
  SELECT
    organizations.id,
    COALESCE(
      (
        SELECT jsonb_agg(to_jsonb(deduped.category) ORDER BY deduped.first_ordinality)
        FROM (
          SELECT mapped.category, MIN(mapped.ordinality) AS first_ordinality
          FROM (
            SELECT
              elem.ordinality,
              COALESCE(category_map.new_category, elem.value) AS category
            FROM jsonb_array_elements_text(organizations.categories)
              WITH ORDINALITY AS elem(value, ordinality)
            LEFT JOIN category_map
              ON category_map.old_category = elem.value
          ) AS mapped
          GROUP BY mapped.category
        ) AS deduped
      ),
      '[]'::jsonb
    ) AS categories
  FROM public.organizations
  WHERE organizations.categories IS NOT NULL
    AND jsonb_typeof(organizations.categories) = 'array'
)
UPDATE public.organizations
SET categories = remapped.categories
FROM remapped
WHERE organizations.id = remapped.id
  AND organizations.categories IS DISTINCT FROM remapped.categories;

-- 4. Update public.users.interests (jsonb array)
WITH remapped AS (
  SELECT
    users.id,
    COALESCE(
      (
        SELECT jsonb_agg(to_jsonb(deduped.interest) ORDER BY deduped.first_ordinality)
        FROM (
          SELECT mapped.interest, MIN(mapped.ordinality) AS first_ordinality
          FROM (
            SELECT
              elem.ordinality,
              COALESCE(category_map.new_category, elem.value) AS interest
            FROM jsonb_array_elements_text(users.interests)
              WITH ORDINALITY AS elem(value, ordinality)
            LEFT JOIN category_map
              ON category_map.old_category = elem.value
          ) AS mapped
          GROUP BY mapped.interest
        ) AS deduped
      ),
      '[]'::jsonb
    ) AS interests
  FROM public.users
  WHERE users.interests IS NOT NULL
    AND jsonb_typeof(users.interests) = 'array'
)
UPDATE public.users
SET interests = remapped.interests
FROM remapped
WHERE users.id = remapped.id
  AND users.interests IS DISTINCT FROM remapped.interests;

-- 5. Recreate the check constraint on public.events.category
ALTER TABLE public.events
  ADD CONSTRAINT chk_events_category_valid
  CHECK (
    category IS NULL
    OR category IN (
      'Arts & Culture',
      'Business',
      'Community Service',
      'Environment',
      'Games & Recreation',
      'Health',
      'Media & Web',
      'Politics & Advocacy',
      'Religion & Spirituality'
    )
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
