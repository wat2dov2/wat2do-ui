-- One site-wide banner, edited rather than accumulated.
--
-- The banner is a single piece of copy shown above the navigation on every
-- page, so it is one row that gets updated: the check constraint makes that
-- structural rather than a convention someone has to remember. There is no
-- ordering column because nothing is ordered, and no date window because
-- turning it off is what `enabled` is for.
--
-- `message` may contain {{school}}, which the site replaces with the name of
-- the school whose subdomain the visitor is on.

CREATE TABLE IF NOT EXISTS public.site_banner (
    id         smallint PRIMARY KEY DEFAULT 1,
    enabled    boolean NOT NULL DEFAULT false,
    message    text NOT NULL,
    cta_label  text NOT NULL,
    cta_href   text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT site_banner_is_a_single_row CHECK (id = 1),
    CONSTRAINT site_banner_message_not_blank CHECK (length(btrim(message)) > 0),
    CONSTRAINT site_banner_cta_label_not_blank CHECK (length(btrim(cta_label)) > 0),
    CONSTRAINT site_banner_cta_href_not_blank CHECK (length(btrim(cta_href)) > 0)
);

INSERT INTO public.site_banner (id, enabled, message, cta_label, cta_href)
VALUES (
    1,
    true,
    'Put up Wat2Do posters at {{school}} and get paid for every student who joins.',
    'Learn more',
    '/posters'
)
ON CONFLICT (id) DO NOTHING;
