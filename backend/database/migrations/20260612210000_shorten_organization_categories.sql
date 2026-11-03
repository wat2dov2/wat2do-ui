-- Shorten organization category labels while preserving taxonomy meaning.

WITH category_map(old_category, new_category) AS (
  VALUES
    ('Business and Entrepreneurial', 'Business'),
    ('Entrepreneurship', 'Business'),
    ('Networking', 'Business'),
    ('Career', 'Business'),
    ('Charitable, Community Service & International Development', 'Community Service'),
    ('Volunteering', 'Community Service'),
    ('Creative Arts, Dance and Music', 'Arts & Culture'),
    ('Cultural', 'Arts & Culture'),
    ('Culture', 'Arts & Culture'),
    ('Art', 'Arts & Culture'),
    ('Dance', 'Arts & Culture'),
    ('Music', 'Arts & Culture'),
    ('Design', 'Arts & Culture'),
    ('Environmental and Sustainability', 'Environment'),
    ('Environmental', 'Environment'),
    ('Games, Recreational and Social', 'Games & Recreation'),
    ('Social & Games', 'Games & Recreation'),
    ('Social and Games', 'Games & Recreation'),
    ('Games', 'Games & Recreation'),
    ('Gaming', 'Games & Recreation'),
    ('Partying', 'Games & Recreation'),
    ('Health Promotion', 'Health'),
    ('Health', 'Health'),
    ('Wellness', 'Health'),
    ('Mental Health', 'Health'),
    ('Food', 'Health'),
    ('Sports', 'Health'),
    ('Athletics', 'Health'),
    ('Media, Publications and Web Development', 'Media & Web'),
    ('Technology', 'Media & Web'),
    ('Political and Social Awareness', 'Politics & Advocacy'),
    ('Academic', 'Politics & Advocacy'),
    ('Academics', 'Politics & Advocacy'),
    ('Advocacy', 'Politics & Advocacy'),
    ('Studying', 'Politics & Advocacy'),
    ('Religious and Spiritual', 'Religion & Spirituality'),
    ('Religious', 'Religion & Spirituality'),
    ('Religion', 'Religion & Spirituality')
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
