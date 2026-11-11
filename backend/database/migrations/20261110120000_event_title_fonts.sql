-- The web font closest to the lettering of an event's title on its poster,
-- picked by the ingestion agent from controlbox/event_discovery.json
-- `title_fonts`, so the events page can set the title the way the poster does.
-- Null when the poster's title is plain or unreadable.

begin;

alter table public.events
  add column title_font text
  constraint events_title_font_length check (title_font is null or length(title_font) between 1 and 60);

commit;
