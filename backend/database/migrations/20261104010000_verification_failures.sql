-- Wrong six-digit login codes, one row per miss. Counting them per address in the
-- database caps guesses across IPs, app tasks and freshly sent codes, which the
-- in-memory per-task rate limiter could not. The backend prunes an address's rows
-- older than the guess window whenever it records a new miss, and clears them on a
-- successful sign-in.

begin;

create table public.verification_failures (
  identifier varchar(255) not null,
  failed_at timestamptz not null default now()
);

create index verification_failures_identifier_failed_at_idx
  on public.verification_failures (identifier, failed_at);

alter table public.verification_failures enable row level security;

commit;
