"""Cross-cutting constants shared across backend modules.

Single source of truth for values that appear in multiple services,
routers, seeds, or scripts. Import from here instead of hardcoding.

Constants used in ``Literal`` type annotations are marked ``Final``
so that type-checkers (mypy / pyright) accept them inside ``Literal[]``.
"""

from typing import Final

# ---------------------------------------------------------------------------
# User roles (must match the ``role`` column values in the ``users`` table)
# ---------------------------------------------------------------------------
ROLE_ADMIN: Final = "admin"
ROLE_USER: Final = "user"

# ---------------------------------------------------------------------------
# Submission statuses (event_submissions.status column)
# ---------------------------------------------------------------------------
SUBMISSION_PENDING: Final = "pending"
SUBMISSION_APPROVED: Final = "approved"
SUBMISSION_REJECTED: Final = "rejected"

SUBMISSION_STATUSES = (SUBMISSION_PENDING, SUBMISSION_APPROVED, SUBMISSION_REJECTED)

# ---------------------------------------------------------------------------
# Report statuses (reported_events.status column)
# ---------------------------------------------------------------------------
REPORT_PENDING: Final = "pending"
REPORT_RESOLVED: Final = "resolved"
REPORT_DISMISSED: Final = "dismissed"

REPORT_STATUSES = (REPORT_PENDING, REPORT_RESOLVED, REPORT_DISMISSED)

# ---------------------------------------------------------------------------
# Event categories & interest mappings
# ---------------------------------------------------------------------------
EVENT_CATEGORIES = (
    "Academics",
    "Studying",
    "Career",
    "Networking",
    "Games",
    "Partying",
    "Athletics",
    "Art",
    "Dance",
    "Culture",
    "Religion",
    "Advocacy",
    "Technology",
    "Design",
    "Entrepreneurship",
    "Health",
    "Wellness",
    "Mental Health",
    "Music",
    "Sports",
    "Food",
    "Volunteering",
)

# Map user profile interests to event categories.
# User interests (12) don't map 1:1 to event categories (22).
INTEREST_TO_CATEGORIES: dict[str, list[str]] = {
    "Academic": ["Academics", "Studying"],
    "Social": ["Partying", "Games", "Dance"],
    "Career": ["Career", "Networking", "Entrepreneurship"],
    "Sports": ["Athletics", "Sports"],
    "Music": ["Music"],
    "Art": ["Art", "Design"],
    "Technology": ["Technology"],
    "Gaming": ["Games"],
    "Food": ["Food"],
    "Networking": ["Networking", "Career"],
    "Health": ["Health", "Wellness", "Mental Health"],
    "Cultural": ["Culture", "Religion", "Advocacy"],
}

# Map legacy/old category values to canonical (for migrations and seeds).
CATEGORY_NORMALIZE_MAP = {
    "Academic": "Academics",
    "Clubs": "Academics",
    "Religious": "Religion",
    "Cultural": "Culture",
    "Social & Games": "Games",
    "Sports & Fitness": "Sports",
    "Career & Networking": "Career",
    "Creative Arts": "Art",
    "Arts & Crafts": "Art",
    "Health & Wellness": "Health",
    "Music & Performance": "Music",
}

# ---------------------------------------------------------------------------
# Storage bucket names (must match Supabase bucket IDs)
# ---------------------------------------------------------------------------
BUCKET_EVENT_IMAGES = "event-images"
BUCKET_AVATARS = "avatars"
BUCKET_CLUB_LOGOS = "club-logos"
BUCKET_QR_ASSETS = "qr-assets"

# ---------------------------------------------------------------------------
# Upload file-size limits (bytes).  Used by StorageService bucket configs
# and the uploads router validation.  Keep in sync with the bucket
# file_size_limit values in supabase/migrations/.
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
# Upper bound for page number.  Combined with ``MAX_PAGE_SIZE`` this caps
# the worst-case ``OFFSET`` at ~100k rows — large enough for legitimate
# admin navigation, small enough to stay within sane DB scan budgets.
# Anything deeper should use cursor pagination, not a bigger offset (P20).
MAX_PAGE_NUMBER = 1_000

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

# Query-parameter limits (search / filter strings in GET endpoints)
MAX_SEARCH_QUERY_LENGTH = 200        # free-text search terms
MAX_STATUS_FILTER_LENGTH = 30        # status enum filter (e.g. "pending", "approved")

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

# Club fields
MAX_CLUB_NAME_LENGTH = 200           # club display name
MAX_CLUB_TYPE_LENGTH = 100           # short classification value (mirrors event)
MAX_CLUB_CATEGORY_LENGTH = 100       # single category tag
MAX_CLUB_CATEGORY_COUNT = 20         # max categories per club
MAX_INTEGRATION_METADATA_KEYS = 20   # max metadata keys per integration
MAX_INTEGRATION_METADATA_KEY_LENGTH = 64    # max key length for integration metadata
MAX_INTEGRATION_METADATA_VALUE_LENGTH = 512 # max value length for integration metadata
MAX_INTEGRATION_NAME_LENGTH = 200    # integration "name" field (display label)

# Price bounds for events (matches max_price query guard in list_events)
MAX_EVENT_PRICE = 100_000            # upper bound for event.price (defensive cap)

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

# Submission & report creation — per-user (authenticated).  Caps how many
# event submissions a single user can create in a window; admin review queue
# degrades quickly under flood.  Report creation is rate-limited on the same
# dependency to stop a single user filling the reports table.
SUBMISSION_RATE_LIMIT_MAX_REQUESTS = 10
SUBMISSION_RATE_LIMIT_WINDOW_SECONDS = 3600  # 10 submissions per hour per user
REPORT_RATE_LIMIT_MAX_REQUESTS = 5
REPORT_RATE_LIMIT_WINDOW_SECONDS = 60        # 5 reports per minute per user

# Saved events cap — hard ceiling enforced at the save endpoint to prevent
# a single account from growing an unbounded bookmark list (DoS vector).
MAX_SAVED_EVENTS_PER_USER = 10_000

# ---------------------------------------------------------------------------
# Calendar feed — ICS subscription
# ---------------------------------------------------------------------------
# Apple polls every ~1h, Google every 12-24h.  60 requests/hour per token
# is generous headroom for legitimate clients (covers a user syncing
# across several devices behind a shared NAT) while capping a broken
# client's polling loop. Keyed on token so one misbehaving user can't
# affect others on the same network.
CALENDAR_FEED_RATE_LIMIT_MAX_REQUESTS = 60
CALENDAR_FEED_RATE_LIMIT_WINDOW_SECONDS = 3600

# Map ``events.school`` -> IANA timezone string.  Keys are the canonical
# school names from ``core.allowed_emails.ALLOWED_EMAIL_DOMAINS`` values,
# lowercased.  Lookup goes via ``resolve_school_timezone`` which also
# consults ``SCHOOL_ALIASES`` and falls back to UTC with a warning log.
#
# When a new school is onboarded (added to ALLOWED_EMAIL_DOMAINS), add
# its timezone here in the same change — the log warning is the signal
# that a school is missing from the map.
SCHOOL_TIMEZONES: dict[str, str] = {
    "university of waterloo": "America/Toronto",
    "wilfrid laurier university": "America/Toronto",
    "university of guelph": "America/Toronto",
    "conestoga college": "America/Toronto",
}

# Common user-typed variants of school names that map to a canonical
# key in SCHOOL_TIMEZONES.  Keep keys lowercase and whitespace-stripped
# so the normalizer only has to do casefold + strip.
SCHOOL_ALIASES: dict[str, str] = {
    "uw": "university of waterloo",
    "u of w": "university of waterloo",
    "uwaterloo": "university of waterloo",
    "waterloo": "university of waterloo",
    "laurier": "wilfrid laurier university",
    "wlu": "wilfrid laurier university",
    "guelph": "university of guelph",
    "conestoga": "conestoga college",
}

# ---------------------------------------------------------------------------
# PostgreSQL error codes (used by error_handlers and service-level catches)
# See: https://www.postgresql.org/docs/current/errcodes-appendix.html
# ---------------------------------------------------------------------------
PG_UNIQUE_VIOLATION = "23505"
PG_FOREIGN_KEY_VIOLATION = "23503"
PG_NOT_NULL_VIOLATION = "23502"
PG_INSUFFICIENT_PRIVILEGE = "42501"
