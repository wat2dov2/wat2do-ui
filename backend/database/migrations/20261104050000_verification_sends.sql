-- One row per login email sent to an address. Counting them per address in the
-- database caps how many codes one inbox can be sent across IPs and app tasks,
-- which the in-memory per-IP rate limiter could not. The backend records a send
-- before it counts the window (so concurrent requests all count), forgets a send
-- it refuses, and prunes the address's rows older than the window.

begin;

create table public.verification_sends (
  identifier varchar(255) not null,
  sent_at timestamptz not null default now()
);

create index verification_sends_identifier_sent_at_idx
  on public.verification_sends (identifier, sent_at);

alter table public.verification_sends enable row level security;

commit;
