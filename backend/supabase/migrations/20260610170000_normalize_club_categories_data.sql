-- One-time data fix: rewrite non-canonical club category JSONB tags to canonical values.
-- No application-layer alias map; this migration only updates stored rows.

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
          SELECT mapped.canon
          FROM jsonb_array_elements_text(base.categories) AS elem(value)
          CROSS JOIN LATERAL (
            SELECT CASE elem.value
              WHEN 'Academic' THEN 'Political and Social Awareness'
              WHEN 'Academics' THEN 'Political and Social Awareness'
              WHEN 'Advocacy' THEN 'Political and Social Awareness'
              WHEN 'Studying' THEN 'Political and Social Awareness'
              WHEN 'Technology' THEN 'Media, Publications and Web Development'
              WHEN 'Social & Games' THEN 'Games, Recreational and Social'
              WHEN 'Social and Games' THEN 'Games, Recreational and Social'
              WHEN 'Cultural' THEN 'Creative Arts, Dance and Music'
              WHEN 'Culture' THEN 'Creative Arts, Dance and Music'
              WHEN 'Art' THEN 'Creative Arts, Dance and Music'
              WHEN 'Dance' THEN 'Creative Arts, Dance and Music'
              WHEN 'Music' THEN 'Creative Arts, Dance and Music'
              WHEN 'Design' THEN 'Creative Arts, Dance and Music'
              WHEN 'Sports' THEN 'Health Promotion'
              WHEN 'Athletics' THEN 'Health Promotion'
              WHEN 'Games' THEN 'Games, Recreational and Social'
              WHEN 'Partying' THEN 'Games, Recreational and Social'
              WHEN 'Religious' THEN 'Religious and Spiritual'
              WHEN 'Religion' THEN 'Religious and Spiritual'
              WHEN 'Entrepreneurship' THEN 'Business and Entrepreneurial'
              WHEN 'Networking' THEN 'Business and Entrepreneurial'
              WHEN 'Career' THEN 'Business and Entrepreneurial'
              WHEN 'Health' THEN 'Health Promotion'
              WHEN 'Wellness' THEN 'Health Promotion'
              WHEN 'Mental Health' THEN 'Health Promotion'
              WHEN 'Food' THEN 'Health Promotion'
              WHEN 'Volunteering' THEN 'Charitable, Community Service & International Development'
              WHEN 'Environmental' THEN 'Environmental and Sustainability'
              WHEN 'Business and Entrepreneurial' THEN 'Business and Entrepreneurial'
              WHEN 'Charitable, Community Service & International Development' THEN 'Charitable, Community Service & International Development'
              WHEN 'Creative Arts, Dance and Music' THEN 'Creative Arts, Dance and Music'
              WHEN 'Environmental and Sustainability' THEN 'Environmental and Sustainability'
              WHEN 'Games, Recreational and Social' THEN 'Games, Recreational and Social'
              WHEN 'Health Promotion' THEN 'Health Promotion'
              WHEN 'Media, Publications and Web Development' THEN 'Media, Publications and Web Development'
              WHEN 'Political and Social Awareness' THEN 'Political and Social Awareness'
              WHEN 'Religious and Spiritual' THEN 'Religious and Spiritual'
              ELSE NULL
            END AS canon
          ) AS mapped
          WHERE mapped.canon IS NOT NULL
        ) AS canonicalized
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
