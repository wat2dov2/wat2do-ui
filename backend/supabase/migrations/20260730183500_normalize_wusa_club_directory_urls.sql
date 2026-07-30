-- WUSA moved club directory pages to the clubs.wusa.ca subdomain.

UPDATE public.organizations
SET organization_page = replace(
    organization_page,
    'https://wusa.ca/clubs/',
    'https://clubs.wusa.ca/clubs/'
)
WHERE organization_page LIKE 'https://wusa.ca/clubs/%';
