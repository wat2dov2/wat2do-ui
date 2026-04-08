"""Cross-cutting constants shared across backend modules.

Single source of truth for values that appear in multiple services,
routers, seeds, or scripts. Import from here instead of hardcoding.

Constants used in ``Literal`` type annotations are marked ``Final``
so that type-checkers (mypy / pyright) accept them inside ``Literal[]``.
"""

from typing import Final

from tenacity import retry, stop_after_attempt, wait_exponential

# ---------------------------------------------------------------------------
# User roles (must match the ``role`` column values in the ``users`` table)
# ---------------------------------------------------------------------------
ROLE_ADMIN: Final = "admin"
ROLE_USER: Final = "user"

# ---------------------------------------------------------------------------
# Storage bucket names (must match Supabase bucket IDs)
# ---------------------------------------------------------------------------
BUCKET_EVENT_IMAGES = "event-images"
BUCKET_AVATARS = "avatars"
BUCKET_CLUB_LOGOS = "club-logos"
BUCKET_QR_ASSETS = "qr-assets"

# ---------------------------------------------------------------------------
# Upload file-size limits (bytes).  Used by StorageService bucket configs
# and the uploads router validation.  Keep in sync with setup_storage.sql.
# ---------------------------------------------------------------------------
MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024   # 5 MB  – event images, QR assets
MAX_AVATAR_SIZE_BYTES = 2 * 1024 * 1024  # 2 MB  – avatars, club logos

# ---------------------------------------------------------------------------
# List / pagination defaults for non-recommendation endpoints
# ---------------------------------------------------------------------------
DEFAULT_LIST_LIMIT = 100     # events & clubs list default
MAX_LIST_LIMIT = 500         # upper bound enforced by Query(le=...)

# ---------------------------------------------------------------------------
# Interaction defaults
# ---------------------------------------------------------------------------
DEFAULT_INTERACTION_LIMIT = 50   # default limit for popularity queries
MAX_INTERACTION_BATCH_SIZE = 50  # max interactions per single batch request
# Deduplication: max identical (user, event, type) interactions within window
MAX_DUPLICATE_INTERACTIONS = 10
DEDUP_WINDOW_MINUTES = 60        # sliding window for deduplication check

# ---------------------------------------------------------------------------
# QR / scan recording
# ---------------------------------------------------------------------------
MAX_USER_AGENT_LENGTH = 512      # truncate user-agent header to this length

# ---------------------------------------------------------------------------
# Interaction types  (validated in schemas/interaction.py via field_validator)
# ---------------------------------------------------------------------------
INTERACTION_VIEW = "view"
INTERACTION_CLICK = "click"
INTERACTION_DETAIL_VIEW = "detail_view"
INTERACTION_SAVE = "save"
INTERACTION_UNSAVE = "unsave"
INTERACTION_SHARE = "share"

INTERACTION_TYPES = (
    INTERACTION_VIEW,
    INTERACTION_CLICK,
    INTERACTION_DETAIL_VIEW,
    INTERACTION_SAVE,
    INTERACTION_UNSAVE,
    INTERACTION_SHARE,
)

# ---------------------------------------------------------------------------
# A/B test event types & default variant
# ---------------------------------------------------------------------------
AB_EVENT_IMPRESSION = "impression"
AB_EVENT_CLICK = "click"

AB_VARIANT_CONTROL = "control"
AB_VARIANT_TREATMENT = "treatment"
AB_DEFAULT_VARIANTS = (AB_VARIANT_CONTROL, AB_VARIANT_TREATMENT)

# ---------------------------------------------------------------------------
# Credits
# ---------------------------------------------------------------------------
DEFAULT_CREDIT_BALANCE = 100
MAX_CREDITS_PER_ADD = 10_000   # upper bound for a single add_credits call

# ---------------------------------------------------------------------------
# Promotion packages — server-authoritative pricing
# Maps package name -> (credit cost, duration in days).
# The client sends only the package name; cost and duration are looked up here.
# ---------------------------------------------------------------------------
PROMOTION_PACKAGES: dict[str, tuple[int, int]] = {
    "featured": (50, 7),
    "email": (100, 1),
    "combo": (200, 7),
}

# ---------------------------------------------------------------------------
# Rate limiting (per-user sliding window)
# ---------------------------------------------------------------------------
RATE_LIMIT_MAX_REQUESTS = 10     # max requests allowed in the window
RATE_LIMIT_WINDOW_SECONDS = 60   # window duration in seconds

# Auth endpoints — per-IP limits (unauthenticated, stricter)
AUTH_RATE_LIMIT_MAX_REQUESTS = 10        # login & signup
AUTH_RATE_LIMIT_WINDOW_SECONDS = 60
AUTH_SENSITIVE_RATE_LIMIT_MAX_REQUESTS = 5   # forgot-password & reset-password
AUTH_SENSITIVE_RATE_LIMIT_WINDOW_SECONDS = 60
AUTH_REFRESH_RATE_LIMIT_MAX_REQUESTS = 30    # token refresh (legitimate clients auto-refresh)
AUTH_REFRESH_RATE_LIMIT_WINDOW_SECONDS = 60

# ---------------------------------------------------------------------------
# Retry decorator for Supabase operations
# ---------------------------------------------------------------------------
# Shared config so every retry site uses identical backoff parameters.
RETRY_STOP = stop_after_attempt(3)
RETRY_WAIT = wait_exponential(multiplier=0.5, max=4)

supabase_retry = retry(stop=RETRY_STOP, wait=RETRY_WAIT)

# ---------------------------------------------------------------------------
# PostgreSQL error codes (used by error_handlers and service-level catches)
# See: https://www.postgresql.org/docs/current/errcodes-appendix.html
# ---------------------------------------------------------------------------
PG_UNIQUE_VIOLATION = "23505"
PG_FOREIGN_KEY_VIOLATION = "23503"
PG_NOT_NULL_VIOLATION = "23502"
PG_INSUFFICIENT_PRIVILEGE = "42501"
