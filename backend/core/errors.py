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
CLUB_NOT_FOUND = "Club not found"
POSTER_NOT_FOUND = "Poster not found"
PAYOUT_NOT_FOUND = "Payout not found"
REPORT_NOT_FOUND = "Report not found"
CALENDAR_FEED_NOT_FOUND = "Calendar feed not found"
NOTIFICATION_PREFERENCE_NOT_FOUND = "Notification preference not found"
UNKNOWN_NOTIFICATION_TYPE = "Unknown notification type"
INSTAGRAM_PUBLISH_BATCH_NOT_FOUND = "Instagram publishing batch not found"
POSITION_NOT_FOUND = "Position not found"

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
CLUB_MEMBER_OR_ADMIN_ACCESS_REQUIRED = "Club manager or admin access required"
NOT_AUTHORIZED = "Not authorized"
EMAIL_NOT_ALLOWED = (
    "Only student emails from allowed schools can sign up. "
    "Use a valid university email (e.g. @uwaterloo.ca)."
)
CLUB_EVENT_CREATION_REQUIRED = "Only approved club owners can create events for their club"
CLUB_PENDING_REVIEW = (
    "This club is still awaiting review. You can publish events once it is approved."
)

# ---------------------------------------------------------------------------
# 400 / 409 – Validation & conflict
# ---------------------------------------------------------------------------
SIGNUP_FAILED = "Unable to create account — check email/password requirements"
PASSWORD_RESET_FAILED = "Unable to reset password — please try again"
EMAIL_OR_USERNAME_TAKEN = "Email already taken"
ID_MISMATCH = "ID mismatch"
REQUIRES_LOCATION = "requires_location"
INVALID_CUSTOM_URL = "custom-url destination_id must be a valid http or https URL"
BATCH_TOO_LARGE = "Batch exceeds maximum size of {limit} interactions"
USER_ID_MISMATCH = "Cannot submit interactions on behalf of another user"
DUPLICATE_INTERACTION_LIMIT = "Too many duplicate interactions for the same event"
INVALID_STATUS_TRANSITION = "Invalid status transition"
DISCOVERY_QUERY_SCHOOL_NOT_FOUND = "Query school is not registered"
SUBMISSION_SCHOOL_REQUIRED = "Submission club school is not registered"
POSITION_ALREADY_EXISTS = "This position already exists"
POSITION_IMAGE_NO_POSITION = "No open position was found in this image"
PROMOTER_ENROLLMENT_REQUIRED = "Promoter enrollment is required"
PROMOTER_PROGRAM_PAUSED = "The promoter program is paused"
PROMOTER_POSTER_LIMIT_REACHED = "Maximum active promoter poster limit reached"
PROMOTER_SCHOOL_REQUIRED = "Choose a school before creating a promoter poster"
PROMOTER_POSTERS_CANNOT_BE_DELETED = "Promoter posters cannot be deleted"
PROMOTER_POSTERS_CANNOT_BE_UPDATED = "Promoter posters cannot be updated"
PROMOTER_TOS_REQUIRED = "You must accept the promoter terms to enroll"
PROMOTER_TEMPLATE_NOT_FOUND = "Approved poster template not found"
PROMOTER_TEMPLATE_UNAVAILABLE = "This poster template is not available for new posters"
PROMOTER_TEMPLATE_SCHOOL_MISMATCH = "This poster template is not available for your school"
INVALID_SCAN_CONFIRMATION = "Invalid or expired scan confirmation"
PAYOUT_NOTES_REQUIRED = "Notes are required when holding or voiding a payout"
PAYOUT_EXPORT_PENDING_ONLY = "Only pending payouts can be exported"
INVALID_PAYOUT_FILTERS = "Invalid payout filter range"
EVENT_ALREADY_PAST = "Event has already ended and cannot be modified"
GOING_EVENTS_CAP_REACHED = "Maximum going events limit reached"
INVALID_EVENT_OCCURRENCE = "One or more occurrences do not belong to this event"
OCCURRENCE_NOT_SELECTABLE = "One or more occurrences can no longer be selected"
SAVED_CLUBS_CAP_REACHED = "Maximum saved clubs limit reached"

INVALID_ROLE = "Role must be 'user' or 'admin'"
CANNOT_DELETE_SELF = "Admins cannot delete their own account"
LAST_ADMIN_REQUIRED = "Cannot remove the last remaining admin"
USER_HAS_PAYOUTS = "Users with payout records cannot be deleted"
USER_HAS_PROMOTER_POSTERS = "Users with promoter posters cannot be deleted"
USER_HAS_PAYOUT_REVIEWS = "Users with payout review records cannot be deleted"
INSTAGRAM_PUBLISH_BATCH_VERSION_CONFLICT = "Instagram publishing batch was changed"
INSTAGRAM_PUBLISH_BATCH_NOT_EDITABLE = "Instagram publishing batch is not editable"
INSTAGRAM_PUBLISHING_NOT_CONFIGURED = "Instagram publishing is not configured"
INSTAGRAM_REAUTHORIZATION_REQUIRED = "Instagram account requires reauthorization"
INSTAGRAM_SONG_EXISTS = "This song is already on the list"
INSTAGRAM_SONG_NOT_FOUND = "Song not found"
EVENT_IMAGE_NO_EVENT = (
    "No event could be read from this image. Try a clearer poster or enter the details manually."
)

# ---------------------------------------------------------------------------
# 502 / 503 – Upstream / AI errors
# ---------------------------------------------------------------------------

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

SPONSOR_SUBMISSION_NOT_FOUND = "Sponsor submission not found"
COMPETITOR_PAIN_POINT_NOT_FOUND = "Competitor pain point not found"
OUTREACH_LEAD_NOT_FOUND = "Outreach lead not found"

# ---------------------------------------------------------------------------
# Ticketing and club payouts
# ---------------------------------------------------------------------------
TICKETING_DISABLED = "Ticket sales aren't available yet"
TICKETING_REQUIRES_CLUB = "Only an event hosted by a club can sell tickets"
PAYOUTS_NOT_READY = "Finish setting up payouts before selling tickets"
TICKETS_NOT_FOR_SALE = "This event isn't selling tickets"
TICKET_SALES_PAUSED = "Ticket sales are paused for this event"
TICKET_SALES_CLOSED = "Ticket sales for this date have closed"
TICKETS_SOLD_OUT = "There aren't enough tickets left for this date"
TICKET_DATE_NOT_FOUND = "That date isn't part of this event"
TICKETED_EVENT_CANCELLED = "This event was cancelled"
TICKET_QUANTITY_TOO_HIGH = "That's more tickets than one order allows"
TICKET_PRICE_OUT_OF_RANGE = "Enter a ticket price within the allowed range"
TICKET_CAPACITY_TOO_HIGH = "That capacity is higher than Wat2Do allows"
TICKET_PRICE_LOCKED = "The price can't change after tickets are sold"
TICKET_CAPACITY_BELOW_SOLD = "Capacity can't be lower than the tickets already sold for a date"
TICKETING_HAS_SALES = "Tickets were already sold for this event. Pause sales instead."
TICKET_REFUNDS_NEED_CANCELLATION = "Cancel the event first to refund every ticket"
EVENT_HAS_TICKETS = "This event has sold tickets. Cancel it instead, and every buyer is refunded."
TICKETED_EVENT_CLUB_LOCKED = "A ticketed event stays with the club selling its tickets"
TICKETED_DATE_IN_USE = "A date with sold tickets can't be removed. Refund those tickets first."
TICKET_NOT_FOUND = "Ticket not found"
TICKET_ORDER_NOT_FOUND = "Order not found"
TICKET_ALREADY_REFUNDED = "This ticket was already refunded"
TICKET_REFUND_AFTER_CHECK_IN = "This ticket was already used at the door"
TICKET_REFUND_ALREADY_DECLINED = "The club already declined a refund for this ticket"
TICKET_REFUND_NOT_REQUESTED = "Nobody asked for a refund on this ticket"
PAYMENT_PROVIDER_UNAVAILABLE = "Payments are unavailable right now. Please try again in a minute."
STRIPE_SIGNATURE_INVALID = "Invalid Stripe signature"
