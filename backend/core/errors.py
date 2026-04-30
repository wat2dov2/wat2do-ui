"""Shared HTTP error detail strings.

Centralises user-facing error messages so routers, services, and
handlers stay DRY and wording stays consistent.  Import individual
constants where needed — do not duplicate literal strings.
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
CLUB_NOT_FOUND = "Club not found"
POSTER_NOT_FOUND = "Poster not found"
SUBMISSION_NOT_FOUND = "Submission not found"
REPORT_NOT_FOUND = "Report not found"
CALENDAR_FEED_NOT_FOUND = "Calendar feed not found"
NOTIFICATION_PREFERENCE_NOT_FOUND = "Notification preference not found"
UNKNOWN_NOTIFICATION_TYPE = "Unknown notification type"

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
NOT_AUTHORIZED = "Not authorized"
EMAIL_NOT_ALLOWED = (
    "Only student emails from allowed schools can sign up. "
    "Use a valid university email (e.g. @uwaterloo.ca)."
)

# ---------------------------------------------------------------------------
# 400 / 409 – Validation & conflict
# ---------------------------------------------------------------------------
SIGNUP_FAILED = "Unable to create account — check email/password requirements"
PASSWORD_RESET_FAILED = "Unable to reset password — please try again"
EMAIL_OR_USERNAME_TAKEN = "Email or username already taken"
INSUFFICIENT_CREDITS = "Insufficient credits"
# C11: machine-readable error code for frontend to branch on without
# relying on the human-readable ``INSUFFICIENT_CREDITS`` message.  Kept
# snake_case so it stays stable across i18n / wording changes.
INSUFFICIENT_CREDITS_CODE = "insufficient_credits"
INVALID_PROMOTION_PACKAGE = "Invalid promotion package"
ID_MISMATCH = "ID mismatch"
REQUIRES_LOCATION = "requires_location"
INVALID_CUSTOM_URL = "custom-url destination_id must be a valid http or https URL"
BATCH_TOO_LARGE = "Batch exceeds maximum size of {limit} interactions"
USER_ID_MISMATCH = "Cannot submit interactions on behalf of another user"
DUPLICATE_INTERACTION_LIMIT = "Too many duplicate interactions for the same event"
INVALID_STATUS_TRANSITION = "Invalid status transition"
EVENT_ALREADY_PAST = "Event has already ended and cannot be modified or promoted"
SAVED_EVENTS_CAP_REACHED = "Maximum saved events limit reached"
RSVPS_CAP_REACHED = "Maximum RSVPs limit reached"
INVALID_ROLE = "Role must be 'user' or 'admin'"
CANNOT_DELETE_SELF = "Admins cannot delete their own account"
LAST_ADMIN_REQUIRED = "Cannot remove the last remaining admin"

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
