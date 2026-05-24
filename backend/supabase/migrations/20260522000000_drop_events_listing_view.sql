-- Drop the events_listing compatibility view.
--
-- Event reads now use the canonical bugfree-style model directly:
-- public.events owns event identity/metadata and public.event_dates owns
-- schedule occurrences.

DROP VIEW IF EXISTS public.events_listing;
