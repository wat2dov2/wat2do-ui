-- One club per Instagram account at a school.
-- Club submissions and follow approvals used to add a second club for a handle a
-- school already had (written as "@Handle", a profile link or plain), so the same
-- club showed up several times. Duplicates were merged on 2026-11-20 (backup in
-- ~/.wat2do-backups/club-dedupe-2026-11-20 on the Mac mini).
--
-- club_handle_key is the one way to compare a club's Instagram handle: a profile
-- link, a leading "@", any path or query and whitespace are dropped, and the rest is
-- lower-cased. A club with no handle has the key ''.
CREATE OR REPLACE FUNCTION public.club_handle_key(handle text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
RETURN lower(regexp_replace(regexp_replace(regexp_replace(btrim(coalesce(handle, '')),
    '^(https?://)?(www\.)?(instagram\.com/)?@?', '', 'i'),
    '[/?#].*$', ''),
    '\s', '', 'g'));

CREATE UNIQUE INDEX clubs_school_handle_key ON public.clubs (school_id, public.club_handle_key(ig))
    WHERE public.club_handle_key(ig) <> '';
