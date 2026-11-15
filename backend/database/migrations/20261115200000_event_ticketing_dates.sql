-- Which dates of an event have tickets. A club picks them in the event's
-- form: a weekly series can sell tickets to its gala alone. Every date of an
-- event that already has tickets keeps them.

begin;

create table public.event_ticketing_dates (
  event_id integer not null references public.event_ticketing (event_id) on delete cascade,
  event_date_id uuid primary key,
  constraint event_ticketing_dates_event_date_fkey
    foreign key (event_id, event_date_id)
    references public.event_dates (event_id, id) on delete cascade
);
create index event_ticketing_dates_event_idx on public.event_ticketing_dates (event_id);

alter table public.event_ticketing_dates enable row level security;

insert into public.event_ticketing_dates (event_id, event_date_id)
select event_date.event_id, event_date.id
from public.event_dates as event_date
join public.event_ticketing as ticketing on ticketing.event_id = event_date.event_id;

commit;
