-- Club tickets: one admission model for free QR tickets and paid ones.
--
-- A club turns tickets on for one of its events in event_ticketing. A price of
-- zero gives free tickets: anyone signed in takes one per date, with a QR code
-- the club scans at the door. A higher price sells tickets through the club's
-- own Stripe Connect Express account: every charge is a direct charge on that
-- account, so ticket money never passes through wat2do. Each paid checkout is a
-- ticket_orders row; a ticket is one admission to one date of an event, held by
-- one person, and its code is the secret printed in its QR code.

begin;

-- A school's country picks its clubs' Stripe account country and ticket currency.
alter table public.schools
  add column country text not null default 'CA'
  constraint schools_country_check check (country in ('CA', 'US'));
update public.schools
set country = 'US'
where slug in ('berkeley', 'columbia', 'cornell', 'mit', 'nyu', 'umich', 'upenn');

-- One Stripe Express account per club. The app never swaps a club's account,
-- so no member can redirect another member's payouts.
create table public.club_payment_accounts (
  club_id integer primary key references public.clubs (id) on delete restrict,
  stripe_account_id text not null unique check (stripe_account_id ~ '^acct_[A-Za-z0-9]+$'),
  country text not null check (country in ('CA', 'US')),
  charges_enabled boolean not null default false,
  payouts_enabled boolean not null default false,
  details_submitted boolean not null default false,
  requirements_due text[] not null default '{}',
  connected_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- How people get into an event. Capacity applies to each date of the event.
create table public.event_ticketing (
  event_id integer primary key references public.events (id) on delete cascade,
  -- Zero for free tickets.
  price_cents integer not null check (price_cents >= 0),
  -- A paid event's currency, fixed by its club's Stripe account.
  currency text check (currency in ('cad', 'usd')),
  capacity integer check (capacity > 0),
  paused boolean not null default false,
  updated_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_ticketing_paid_has_currency check ((price_cents > 0) = (currency is not null))
);

-- One Stripe Checkout. A pending order holds its seats until reserved_until,
-- which outlasts the Checkout session so a late payment still has its seats.
create table public.ticket_orders (
  id uuid primary key default gen_random_uuid(),
  event_id integer not null references public.events (id) on delete restrict,
  event_date_id uuid not null,
  club_id integer not null references public.clubs (id) on delete restrict,
  buyer_user_id uuid not null references public.users (id) on delete restrict,
  buyer_email text not null,
  quantity integer not null check (quantity > 0),
  unit_amount_cents integer not null check (unit_amount_cents > 0),
  currency text not null check (currency in ('cad', 'usd')),
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'expired', 'failed')),
  stripe_account_id text not null,
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text,
  reserved_until timestamptz not null,
  paid_at timestamptz,
  confirmation_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ticket_orders_event_date_fkey
    foreign key (event_id, event_date_id)
    references public.event_dates (event_id, id) on delete restrict
);
create index ticket_orders_seats_idx on public.ticket_orders (event_date_id, status, reserved_until);
create index ticket_orders_buyer_idx on public.ticket_orders (buyer_user_id, created_at desc);
create index ticket_orders_event_idx on public.ticket_orders (event_id);

-- One admission. A free ticket has no order; a paid one belongs to the order
-- that bought it, and its holder is that order's buyer.
create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  event_id integer not null,
  event_date_id uuid not null,
  holder_user_id uuid not null references public.users (id) on delete cascade,
  order_id uuid references public.ticket_orders (id) on delete restrict,
  code text not null unique check (code ~ '^[A-Z2-7]{20,40}$'),
  status text not null default 'valid' check (status in ('valid', 'refunded')),
  checked_in_at timestamptz,
  checked_in_by uuid references public.users (id) on delete set null,
  refunded_at timestamptz,
  refunded_by uuid references public.users (id) on delete set null,
  stripe_refund_id text,
  -- A holder can ask the club for a refund once; the club refunds or declines it.
  refund_requested_at timestamptz,
  refund_request_note text check (refund_request_note is null or length(refund_request_note) <= 500),
  refund_declined_at timestamptz,
  created_at timestamptz not null default now(),
  constraint tickets_event_date_fkey
    foreign key (event_id, event_date_id)
    references public.event_dates (event_id, id) on delete restrict,
  constraint tickets_refund_recorded check ((status = 'refunded') = (refunded_at is not null)),
  constraint tickets_decline_follows_request check (
    refund_declined_at is null or refund_requested_at is not null
  ),
  -- Only a paid ticket has money to refund.
  constraint tickets_free_never_refunded check (
    order_id is not null or (status = 'valid' and refund_requested_at is null)
  )
);
-- One free ticket per person and date.
create unique index tickets_free_holder_date_idx
  on public.tickets (holder_user_id, event_date_id) where order_id is null;
create index tickets_event_date_idx on public.tickets (event_date_id, status);
create index tickets_order_idx on public.tickets (order_id);
create index tickets_event_idx on public.tickets (event_id);
create index tickets_holder_idx on public.tickets (holder_user_id);

create trigger update_club_payment_accounts_timestamp
before update on public.club_payment_accounts
for each row execute function public.handle_update_timestamp();
create trigger update_event_ticketing_timestamp
before update on public.event_ticketing
for each row execute function public.handle_update_timestamp();
create trigger update_ticket_orders_timestamp
before update on public.ticket_orders
for each row execute function public.handle_update_timestamp();

alter table public.club_payment_accounts enable row level security;
alter table public.event_ticketing enable row level security;
alter table public.ticket_orders enable row level security;
alter table public.tickets enable row level security;

-- The Instagram ingestion agent never edits an event that has tickets: its
-- club owns the event's dates and details on wat2do from then on.
create function public.is_ticketed_event(p_event_id integer)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.event_ticketing where event_id = p_event_id);
$$;
revoke all on function public.is_ticketed_event(integer) from public;
grant execute on function public.is_ticketed_event(integer) to wat2do_ingest_agent;

create function public.skip_ingestion_writes_to_ticketed_events()
returns trigger
language plpgsql
as $$
declare
  v_event_id integer;
begin
  if current_user = 'wat2do_ingest_agent' then
    if tg_table_name = 'events' then
      v_event_id := old.id;
    elsif tg_op = 'DELETE' then
      v_event_id := old.event_id;
    else
      v_event_id := new.event_id;
    end if;
    if public.is_ticketed_event(v_event_id) then
      -- Skipping the row leaves the club's event exactly as the club set it.
      return null;
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- Postgres fires BEFORE triggers in name order, and a skipped row stops the
-- rest: this name sorts before every other trigger on these tables, so a
-- write the agent cannot make never records a change alert either.
create trigger agent_skips_ticketed_events
before update or delete on public.events
for each row execute function public.skip_ingestion_writes_to_ticketed_events();
create trigger agent_skips_ticketed_events
before insert or update or delete on public.event_dates
for each row execute function public.skip_ingestion_writes_to_ticketed_events();

-- Never used: tickets record who is admitted, and user_going_events who is going.
drop table public.event_rsvps;

commit;
