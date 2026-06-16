-- Collapse organization categories to the unified EVENT_CATEGORIES taxonomy.

BEGIN;

WITH category_map(old_category, new_category) AS (
  VALUES
    ('Business', 'Entrepreneurship'),
    ('Community Service', 'Volunteering'),
    ('Arts & Culture', 'Art'),
    ('Environment', 'Advocacy'),
    ('Games & Recreation', 'Games'),
    ('Media & Web', 'Technology'),
    ('Politics & Advocacy', 'Advocacy'),
    ('Religion & Spirituality', 'Religion')
),
remapped AS (
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

NOTIFY pgrst, 'reload schema';

COMMIT;
