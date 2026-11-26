-- Whether Wat2Do may promote an event (a carousel slide, the events feed's
-- featured row): any student at its school can attend it and a typical
-- student there would want to go, by rust/src/instagram_publishing/promotion_rules.md
-- (Tony, 2026-11-25). The ingestion agent records it for every event it lists.
-- Null when nobody judged it (events listed before this, and submitted ones);
-- only false keeps an event out of carousel candidates and the featured row.

ALTER TABLE public.events
    ADD COLUMN IF NOT EXISTS promotable boolean;

COMMENT ON COLUMN public.events.promotable IS
    'False when the event is for one group of students or would not appeal to a typical student (promotion_rules.md); null when not judged.';
