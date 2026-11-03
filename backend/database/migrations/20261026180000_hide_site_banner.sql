-- Hide the "support a business near your school" banner on every school.
--
-- Only the switch changes: the row, its copy and the /support-local page stay,
-- so turning the banner back on is setting enabled = true again.

UPDATE public.site_banner
SET enabled = false,
    updated_at = now()
WHERE id = 1;
