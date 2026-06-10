-- Remap legacy organization category JSONB tags to canonical WUSA values.
-- Mirrors LEGACY_ORGANIZATION_CATEGORY_ALIASES in core/constants/organizations.py.

BEGIN;

UPDATE public.clubs AS c
SET categories = remapped.new_categories
FROM (
  SELECT
    base.id,
    COALESCE(
      (
        SELECT jsonb_agg(DISTINCT canon ORDER BY canon)
        FROM (
          SELECT COALESCE(alias.canonical, elem.value) AS canon
          FROM jsonb_array_elements_text(base.categories) AS elem(value)
          LEFT JOIN (
            VALUES
              ('Academic', 'Political and Social Awareness'),
              ('Academics', 'Political and Social Awareness'),
              ('Advocacy', 'Political and Social Awareness'),
              ('Studying', 'Political and Social Awareness'),
              ('Technology', 'Media, Publications and Web Development'),
              ('Social & Games', 'Games, Recreational and Social'),
              ('Social and Games', 'Games, Recreational and Social'),
              ('Cultural', 'Creative Arts, Dance and Music'),
              ('Culture', 'Creative Arts, Dance and Music'),
              ('Art', 'Creative Arts, Dance and Music'),
              ('Dance', 'Creative Arts, Dance and Music'),
              ('Music', 'Creative Arts, Dance and Music'),
              ('Design', 'Creative Arts, Dance and Music'),
              ('Sports', 'Health Promotion'),
              ('Athletics', 'Health Promotion'),
              ('Games', 'Games, Recreational and Social'),
              ('Partying', 'Games, Recreational and Social'),
              ('Religious', 'Religious and Spiritual'),
              ('Religion', 'Religious and Spiritual'),
              ('Entrepreneurship', 'Business and Entrepreneurial'),
              ('Networking', 'Business and Entrepreneurial'),
              ('Career', 'Business and Entrepreneurial'),
              ('Health', 'Health Promotion'),
              ('Wellness', 'Health Promotion'),
              ('Mental Health', 'Health Promotion'),
              ('Food', 'Health Promotion'),
              ('Volunteering', 'Charitable, Community Service & International Development'),
              ('Environmental', 'Environmental and Sustainability')
          ) AS alias(legacy, canonical) ON alias.legacy = elem.value
        ) AS mapped
        WHERE canon IN (
          'Business and Entrepreneurial',
          'Charitable, Community Service & International Development',
          'Creative Arts, Dance and Music',
          'Environmental and Sustainability',
          'Games, Recreational and Social',
          'Health Promotion',
          'Media, Publications and Web Development',
          'Political and Social Awareness',
          'Religious and Spiritual'
        )
      ),
      '[]'::jsonb
    ) AS new_categories
  FROM public.clubs AS base
  WHERE base.categories IS NOT NULL
    AND jsonb_typeof(base.categories) = 'array'
) AS remapped
WHERE c.id = remapped.id
  AND c.categories IS DISTINCT FROM remapped.new_categories;

NOTIFY pgrst, 'reload schema';

COMMIT;
