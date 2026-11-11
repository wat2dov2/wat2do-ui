-- The event's title as its poster sets it, drawn as an SVG by the ingestion
-- agent from the poster (its words in the poster's own colours, weights,
-- outlines and tilt), so the events page can show the title the way the poster
-- does. The page draws it as an image, which runs no script and loads nothing,
-- and the check below keeps it a plain SVG. Null when the poster's title is
-- plain, unreadable or not shown; the page then sets the title as text.

begin;

alter table public.events
  add column title_svg text
  constraint events_title_svg_shape check (
    title_svg is null or (
      title_svg ~ '^<svg[\s>]'
      and title_svg ~ '</svg>\s*$'
      and length(title_svg) <= 20000
      and title_svg !~* '<script|<foreignobject|<iframe|<image|javascript:|\son[a-z]+\s*='
    )
  );

commit;
