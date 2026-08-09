-- Point the site-wide announcement at the founders' story on Contact.

UPDATE public.site_banner
SET message = 'We scraped 3,000+ Waterloo events so students could try more new things.',
    cta_label = 'Read our story',
    cta_href = '/contact',
    updated_at = now()
WHERE id = 1;
