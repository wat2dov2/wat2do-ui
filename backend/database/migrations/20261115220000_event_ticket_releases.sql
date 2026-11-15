-- A club sells an event's tickets in releases. Each release goes on sale at
-- its own time, with its own price and number of tickets for each date of the
-- event that has tickets, and stays on sale until it sells out or the date is
-- over. Releases add up, and a buyer draws from the earliest release on sale
-- with tickets left, at that release's price.
--
-- Every event with tickets gets one release, on sale since its tickets were
-- turned on, with the price and limit it had; every ticket and order already
-- made belongs to it.

begin;

create table public.event_ticket_releases (
  id uuid primary key default gen_random_uuid(),
  event_id integer not null references public.event_ticketing (event_id) on delete cascade,
  on_sale_at timestamptz not null,
  -- Tickets for each of the event's dates with tickets; null for no limit.
  quantity integer check (quantity > 0),
  -- Zero for free tickets.
  price_cents integer not null check (price_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Releases go on sale in a fixed order; checked at commit, so a club's
  -- edit can swap two releases' times.
  constraint event_ticket_releases_on_sale_key unique (event_id, on_sale_at)
    deferrable initially deferred,
  -- A ticket's release belongs to the ticket's own event.
  constraint event_ticket_releases_event_key unique (event_id, id)
);

create trigger update_event_ticket_releases_timestamp
before update on public.event_ticket_releases
for each row execute function public.handle_update_timestamp();

alter table public.event_ticket_releases enable row level security;

insert into public.event_ticket_releases (event_id, on_sale_at, quantity, price_cents)
select event_id, created_at, capacity, price_cents
from public.event_ticketing;

alter table public.tickets add column release_id uuid;
alter table public.ticket_orders add column release_id uuid;

update public.tickets as ticket
set release_id = release.id
from public.event_ticket_releases as release
where release.event_id = ticket.event_id;

update public.ticket_orders as ticket_order
set release_id = release.id
from public.event_ticket_releases as release
where release.event_id = ticket_order.event_id;

alter table public.tickets
  alter column release_id set not null,
  add constraint tickets_release_fkey
    foreign key (event_id, release_id)
    references public.event_ticket_releases (event_id, id) on delete restrict;
alter table public.ticket_orders
  alter column release_id set not null,
  add constraint ticket_orders_release_fkey
    foreign key (event_id, release_id)
    references public.event_ticket_releases (event_id, id) on delete restrict;

create index tickets_release_idx on public.tickets (release_id, event_date_id, status);
create index ticket_orders_release_idx on public.ticket_orders (release_id, status, reserved_until);

-- Each release has its own price and limit now; the currency stays with the
-- event, fixed by its club's Stripe account.
alter table public.event_ticketing
  drop constraint event_ticketing_paid_has_currency,
  drop column price_cents,
  drop column capacity;

commit;
