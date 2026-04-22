"""Retry decorator for Supabase / PostgREST operations.

Extracted from ``core.constants`` because this is instantiated behavior
(a configured decorator), not a plain data constant.

**Idempotency requirement (P14).** ``supabase_retry`` is safe to apply
ONLY to idempotent operations — i.e. operations that can run twice with
the same effect as running once.  These include:

  * ``SELECT`` reads
  * ``UPSERT`` / ``INSERT ... ON CONFLICT DO UPDATE`` keyed on a unique
    business identifier
  * ``UPDATE`` / ``DELETE`` with a specific ``WHERE`` clause

Do **not** decorate operations that are not idempotent, such as:

  * Plain ``INSERT`` without conflict handling (duplicates on retry)
  * RPCs or writes that generate an auto-incrementing ID and return it
  * Side-effects with external systems (email, webhooks, payments)

If retrying a non-idempotent call is genuinely required, use a
transactional wrapper (e.g. advisory lock + existence check) instead.

**Thundering-herd prevention (P14).** Under a Supabase outage, every
in-flight request retries on the same backoff schedule; without jitter
all clients release simultaneously and re-DoS the upstream on
recovery.  ``wait_exponential_jitter`` adds a random component that
spreads retry traffic.
"""

from tenacity import retry, stop_after_attempt, wait_exponential_jitter

# Shared config so every retry site uses identical backoff parameters.
# ``wait_exponential_jitter`` uses exponential-backoff with a random
# additive delay (defaults to jitter=1.0s).  initial=0.5s, max=4s matches
# the prior schedule while avoiding synchronized post-outage retries.
RETRY_STOP = stop_after_attempt(3)
RETRY_WAIT = wait_exponential_jitter(initial=0.5, max=4, jitter=1.0)

#: Retry decorator for **idempotent** Supabase / PostgREST calls (see module
#: docstring for the idempotency contract).
supabase_retry = retry(stop=RETRY_STOP, wait=RETRY_WAIT)
