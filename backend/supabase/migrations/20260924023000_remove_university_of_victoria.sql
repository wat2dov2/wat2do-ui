-- Remove the retired school and its discovery history.
-- The email domain is removed by schools' existing ON DELETE CASCADE relation.
-- Other school relationships retain RESTRICT so unexpected content is not lost.
BEGIN;

DELETE FROM public.discovery_queries
USING public.schools
WHERE discovery_queries.school_id = schools.id
  AND schools.slug = 'uvic';

DELETE FROM public.schools WHERE slug = 'uvic';

COMMIT;
