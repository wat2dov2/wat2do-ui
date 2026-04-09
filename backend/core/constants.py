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

# Admin list pagination (page-based)
DEFAULT_PAGE_SIZE = 50       # default items per page for admin endpoints
MAX_PAGE_SIZE = 100          # upper bound for page_size query param

# ---------------------------------------------------------------------------
# Interaction defaults
# ---------------------------------------------------------------------------
DEFAULT_INTERACTION_LIMIT = 50   # default limit for popularity queries
MAX_INTERACTION_BATCH_SIZE = 50  # max interactions per single batch request
MAX_INTERACTION_METADATA_BYTES = 2048  # max serialised size of metadata per interaction
# Deduplication: max identical (user, event, type) interactions within window
MAX_DUPLICATE_INTERACTIONS = 3
DEDUP_WINDOW_MINUTES = 60        # sliding window for deduplication check
# Global cap: max total interactions a single user can record per dedup window,
# regardless of how many distinct events/types they target.  Prevents a bot
# account from gaming popularity by spreading interactions across many events.
MAX_USER_INTERACTIONS_PER_WINDOW = 100

# ---------------------------------------------------------------------------
# Input size limits for Pydantic schemas
# ---------------------------------------------------------------------------
MAX_SESSION_ID_LENGTH = 128          # UUIDs / short opaque tokens
MAX_USERNAME_LENGTH = 100            # matches DB VARCHAR(100)
MAX_FULL_NAME_LENGTH = 255           # matches DB VARCHAR(255)
MAX_FACULTY_LENGTH = 255             # matches DB VARCHAR(255)
MAX_SCHOOL_LENGTH = 255              # matches DB VARCHAR(255)
MAX_INTEREST_LENGTH = 100            # single interest tag
MAX_INTERESTS_COUNT = 50             # max items in interests list
MAX_REPORT_REASON_LENGTH = 2000      # free-text report reason
MAX_REJECTION_REASON_LENGTH = 2000   # admin rejection reason
MAX_AVATAR_URL_LENGTH = 2048         # URL length (RFC 2616 practical limit)
MAX_URL_LENGTH = 2048                # general URL length (RFC 2616 practical limit)
MAX_EVENT_DATA_BYTES = 32_768        # 32 KB – serialised submission event_data

# Event fields
MAX_EVENT_TITLE_LENGTH = 300         # generous for long event names
MAX_EVENT_DESCRIPTION_LENGTH = 5000  # detailed descriptions, not unbounded
MAX_EVENT_LOCATION_LENGTH = 500      # full address / venue name
MAX_EVENT_ORGANIZATION_LENGTH = 255  # organisation name
MAX_EVENT_CLUB_TYPE_LENGTH = 100     # short classification value
MAX_EVENT_SCHOOL_LENGTH = 255        # school name (matches user school limit)
MAX_EVENT_CATEGORY_LENGTH = 100      # category enum value
MAX_EVENT_HANDLE_LENGTH = 255        # social-media handle or profile URL
MAX_EVENT_FOOD_ITEM_LENGTH = 100     # single food item tag
MAX_EVENT_FOOD_COUNT = 20            # max food items per event

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

# Anonymous interaction batches — per-IP (no user identity to key on).
# More generous than auth limits since legitimate frontends fire view/impression
# events on every scroll, but tight enough to stop automated flooding.
ANON_INTERACTION_RATE_LIMIT_MAX_REQUESTS = 60
ANON_INTERACTION_RATE_LIMIT_WINDOW_SECONDS = 60

# QR scan recording — per-IP.  Normal usage is a single scan per poster;
# a burst of >30 requests/minute from one IP is clearly automated.
QR_SCAN_RATE_LIMIT_MAX_REQUESTS = 30
QR_SCAN_RATE_LIMIT_WINDOW_SECONDS = 60

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
