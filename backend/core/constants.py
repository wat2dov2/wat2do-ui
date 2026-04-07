"""Cross-cutting constants shared across backend modules.

Single source of truth for values that appear in multiple services,
routers, seeds, or scripts. Import from here instead of hardcoding.
"""

from tenacity import retry, stop_after_attempt, wait_exponential

# ---------------------------------------------------------------------------
# Storage bucket names (must match Supabase bucket IDs)
# ---------------------------------------------------------------------------
BUCKET_EVENT_IMAGES = "event-images"
BUCKET_AVATARS = "avatars"
BUCKET_CLUB_LOGOS = "club-logos"
BUCKET_QR_ASSETS = "qr-assets"

# ---------------------------------------------------------------------------
# List / pagination defaults for non-recommendation endpoints
# ---------------------------------------------------------------------------
DEFAULT_LIST_LIMIT = 100     # events & clubs list default
MAX_LIST_LIMIT = 500         # upper bound enforced by Query(le=...)

# ---------------------------------------------------------------------------
# Credits
# ---------------------------------------------------------------------------
DEFAULT_CREDIT_BALANCE = 100

# ---------------------------------------------------------------------------
# Retry decorator for Supabase operations
# ---------------------------------------------------------------------------
# Shared config so every retry site uses identical backoff parameters.
RETRY_STOP = stop_after_attempt(3)
RETRY_WAIT = wait_exponential(multiplier=0.5, max=4)

supabase_retry = retry(stop=RETRY_STOP, wait=RETRY_WAIT)
