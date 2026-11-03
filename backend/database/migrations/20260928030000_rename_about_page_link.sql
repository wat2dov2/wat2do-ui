-- Keep the founder-story banner on the renamed public About page.
UPDATE public.site_banner
SET cta_href = '/about',
    updated_at = now()
WHERE cta_href = '/contact';
