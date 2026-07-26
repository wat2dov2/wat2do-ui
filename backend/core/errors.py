"""Shared HTTP error detail strings.

Centralises user-facing error messages so routers, services, and
handlers stay DRY and wording stays consistent.  Import individual
constants where needed - do not duplicate literal strings.
"""

from core.constants import (
    PG_FOREIGN_KEY_VIOLATION,
    PG_INSUFFICIENT_PRIVILEGE,
    PG_NOT_NULL_VIOLATION,
    PG_UNIQUE_VIOLATION,
)

# ---------------------------------------------------------------------------
# 404 – Resource not found
# ---------------------------------------------------------------------------
USER_NOT_FOUND = "User not found"
USER_PROFILE_NOT_FOUND = "User profile not found — complete signup first"
EVENT_NOT_FOUND = "Event not found"
SUBMISSION_NOT_FOUND = "Submission not found"
ORGANIZATION_NOT_FOUND = "Organization not found"
POSTER_NOT_FOUND = "Poster not found"
PAYOUT_NOT_FOUND = "Payout not found"
REPORT_NOT_FOUND = "Report not found"
CALENDAR_FEED_NOT_FOUND = "Calendar feed not found"
NOTIFICATION_PREFERENCE_NOT_FOUND = "Notification preference not found"
UNKNOWN_NOTIFICATION_TYPE = "Unknown notification type"
INSTAGRAM_PUBLISH_BATCH_NOT_FOUND = "Instagram publishing batch not found"

# ---------------------------------------------------------------------------
# 401 – Authentication
# ---------------------------------------------------------------------------
INVALID_OR_EXPIRED_TOKEN = "Invalid or expired token"
CREDENTIALS_INVALID = "Could not validate credentials"
NO_REFRESH_TOKEN = "No refresh token"
INVALID_EMAIL_OR_PASSWORD = "Invalid email or password"
SESSION_REFRESH_FAILED = "Could not refresh session — please log in again"

# ---------------------------------------------------------------------------
# 403 – Authorization
# ---------------------------------------------------------------------------
ADMIN_ACCESS_REQUIRED = "Admin access required"
ORGANIZATION_MEMBER_OR_ADMIN_ACCESS_REQUIRED = "Organization manager or admin access required"
NOT_AUTHORIZED = "Not authorized"
EMAIL_NOT_ALLOWED = (
    "Only student emails from allowed schools can sign up. "
    "Use a valid university email (e.g. @uwaterloo.ca)."
)
ORGANIZATION_EVENT_CREATION_REQUIRED = (
    "Only approved organization owners can create events for their organization"
)
ORGANIZATION_PENDING_REVIEW = (
    "This organization is still awaiting review. You can publish events once it is approved."
)

# ---------------------------------------------------------------------------
# 400 / 409 – Validation & conflict
# ---------------------------------------------------------------------------
SIGNUP_FAILED = "Unable to create account — check email/password requirements"
PASSWORD_RESET_FAILED = "Unable to reset password — please try again"
EMAIL_OR_USERNAME_TAKEN = "Email already taken"
INSUFFICIENT_CREDITS = "Insufficient credits"
# Machine-readable error code for frontend to branch on without
# relying on the human-readable ``INSUFFICIENT_CREDITS`` message.  Kept
# snake_case so it stays stable across i18n / wording changes.
INSUFFICIENT_CREDITS_CODE = "insufficient_credits"
INVALID_PROMOTION_PACKAGE = "Invalid promotion package"
ORGANIZATION_PROMOTION_REQUIRED = (
    "Only organization owners can promote events from their organization"
)
EVENT_NOT_ACTIVE = "Only published events can be promoted"
ID_MISMATCH = "ID mismatch"
REQUIRES_LOCATION = "requires_location"
INVALID_CUSTOM_URL = "custom-url destination_id must be a valid http or https URL"
BATCH_TOO_LARGE = "Batch exceeds maximum size of {limit} interactions"
USER_ID_MISMATCH = "Cannot submit interactions on behalf of another user"
DUPLICATE_INTERACTION_LIMIT = "Too many duplicate interactions for the same event"
INVALID_STATUS_TRANSITION = "Invalid status transition"
PROMOTER_ENROLLMENT_REQUIRED = "Promoter enrollment is required"
PROMOTER_PROGRAM_PAUSED = "The promoter program is paused"
PROMOTER_POSTER_LIMIT_REACHED = "Maximum active promoter poster limit reached"
PROMOTER_SCHOOL_REQUIRED = "Choose a school before creating a promoter poster"
PROMOTER_POSTERS_CANNOT_BE_DELETED = "Promoter posters must be archived, not deleted"
PROMOTER_TOS_REQUIRED = "You must accept the promoter terms to enroll"
INVALID_SCAN_CONFIRMATION = "Invalid or expired scan confirmation"
PAYOUT_NOTES_REQUIRED = "Notes are required when holding or voiding a payout"
EVENT_ALREADY_PAST = "Event has already ended and cannot be modified or promoted"
GOING_EVENTS_CAP_REACHED = "Maximum going events limit reached"
INVALID_EVENT_OCCURRENCE = "One or more occurrences do not belong to this event"
OCCURRENCE_NOT_SELECTABLE = "One or more occurrences can no longer be selected"
SAVED_ORGANIZATIONS_CAP_REACHED = "Maximum saved organizations limit reached"

INVALID_ROLE = "Role must be 'user' or 'admin'"
CANNOT_DELETE_SELF = "Admins cannot delete their own account"
LAST_ADMIN_REQUIRED = "Cannot remove the last remaining admin"
USER_HAS_PAYOUTS = "Users with payout records cannot be deleted"
INSTAGRAM_PUBLISH_BATCH_VERSION_CONFLICT = "Instagram publishing batch was changed"
INSTAGRAM_PUBLISH_BATCH_NOT_EDITABLE = "Instagram publishing batch is not editable"
INSTAGRAM_PUBLISHING_NOT_CONFIGURED = "Instagram publishing is not configured"
INSTAGRAM_REAUTHORIZATION_REQUIRED = "Instagram account requires reauthorization"

# ---------------------------------------------------------------------------
# 502 / 503 – Upstream / AI errors
# ---------------------------------------------------------------------------
AI_EMPTY_RESPONSE = "Empty response from AI. Please try a different prompt."
AI_INVALID_JSON = "AI returned invalid JSON. Please try again."
AI_NOT_CONFIGURED = "OpenAI API key not configured on the server."

# ---------------------------------------------------------------------------
# 429 – Rate limiting
# ---------------------------------------------------------------------------
RATE_LIMIT_EXCEEDED = "Too many requests — please wait before trying again."

# ---------------------------------------------------------------------------
# Global error handler defaults
# ---------------------------------------------------------------------------
AUTHENTICATION_ERROR = "Authentication error"
DB_OPERATION_FAILED = "Database operation failed"
INTERNAL_SERVER_ERROR = "Internal server error"

# PostgreSQL error code -> (HTTP status, safe user-facing message)
PG_CODE_TO_HTTP: dict[str, tuple[int, str]] = {
    PG_UNIQUE_VIOLATION: (409, "Resource already exists"),
    PG_FOREIGN_KEY_VIOLATION: (400, "Referenced resource does not exist"),
    PG_NOT_NULL_VIOLATION: (400, "Required field is missing"),
    PG_INSUFFICIENT_PRIVILEGE: (403, "Insufficient permissions"),
}

# ---------------------------------------------------------------------------
# 500 / Service errors
# ---------------------------------------------------------------------------
FAILED_TO_GENERATE_TOKEN = "Unable to generate login link. Please try again later."
FAILED_TO_SAVE_TOKEN = "Unable to save verification token. Please try again later."
REGISTRATION_FAILED = "Unable to complete registration. Please try again later."
