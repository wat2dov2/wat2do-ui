-- Ticket tiers: an event's tickets come in named tiers ("General", "Members",
-- "Early bird"), each with its own price and, optionally, its own limit. The
-- event's capacity becomes one limit on every ticket to the event, whatever
-- its date, instead of a limit on each date.
--
-- Every event that already has tickets gets one "General admission" tier at
-- its old price, and every ticket and order joins it.

begin;

create table public.ticket_tiers (
  id uuid primary key default gen_random_uuid(),
  event_id integer not null references public.event_ticketing (event_id) on delete cascade,
  name text not null check (name = btrim(name) and length(name) between 1 and 60),
  -- Zero for free tickets, one per person and date.
  price_cents integer not null check (price_cents >= 0),
  -- Null when only the event's own limit applies.
  capacity integer check (capacity > 0),
  -- Where the tier sits in the club's list, first at zero.
  position integer not null check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ticket_tiers_event_id_id_key unique (event_id, id)
);
create index ticket_tiers_event_idx on public.ticket_tiers (event_id, position);

create trigger update_ticket_tiers_timestamp
before update on public.ticket_tiers
for each row execute function public.handle_update_timestamp();

alter table public.ticket_tiers enable row level security;

insert into public.ticket_tiers (event_id, name, price_cents, position)
select event_id, 'General admission', price_cents, 0
from public.event_ticketing;

-- A ticket and an order belong to one tier of their own event.
alter table public.ticket_orders add column tier_id uuid;
update public.ticket_orders o
set tier_id = tier.id
from public.ticket_tiers tier
where tier.event_id = o.event_id;
alter table public.ticket_orders
  alter column tier_id set not null,
  add constraint ticket_orders_tier_fkey
    foreign key (event_id, tier_id)
    references public.ticket_tiers (event_id, id) on delete restrict;
create index ticket_orders_tier_idx on public.ticket_orders (tier_id, status, reserved_until);

alter table public.tickets add column tier_id uuid;
update public.tickets t
set tier_id = tier.id
from public.ticket_tiers tier
where tier.event_id = t.event_id;
alter table public.tickets
  alter column tier_id set not null,
  add constraint tickets_tier_fkey
    foreign key (event_id, tier_id)
    references public.ticket_tiers (event_id, id) on delete restrict;
create index tickets_tier_idx on public.tickets (tier_id, status);

-- The limit now counts the whole event: an event that limited each of its
-- dates keeps the same room in all.
update public.event_ticketing ticketing
set capacity = ticketing.capacity * dates.count
from (
  select event_id, count(*)::integer as count
  from public.event_dates
  group by event_id
) dates
where dates.event_id = ticketing.event_id
  and ticketing.capacity is not null
  and dates.count > 1;

-- Each tier has its price now; the currency stays on the event, fixed by its
-- club's Stripe account once any tier is paid.
alter table public.event_ticketing
  drop constraint event_ticketing_paid_has_currency,
  drop column price_cents;

commit;
