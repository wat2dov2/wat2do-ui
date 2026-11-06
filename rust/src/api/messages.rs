//! User-facing error strings, the same bytes as `backend/core/errors.py`.
//! `backend/tests/test_rust_constants.py` fails when a string here drifts from
//! its Python namesake; add a string here (same name) when a ported route needs it.

pub const USER_NOT_FOUND: &str = "User not found";
pub const INVALID_OR_EXPIRED_TOKEN: &str = "Invalid or expired token";
pub const CREDENTIALS_INVALID: &str = "Could not validate credentials";
pub const ADMIN_ACCESS_REQUIRED: &str = "Admin access required";
pub const CLUB_MEMBER_OR_ADMIN_ACCESS_REQUIRED: &str = "Club manager or admin access required";
pub const NOT_AUTHORIZED: &str = "Not authorized";
pub const RATE_LIMIT_EXCEEDED: &str = "Too many requests \u{2014} please wait before trying again.";
pub const DB_OPERATION_FAILED: &str = "Database operation failed";
pub const INTERNAL_SERVER_ERROR: &str = "Internal server error";

/// `PG_CODE_TO_HTTP`: Postgres error code to (HTTP status, safe message).
pub const PG_CODE_TO_HTTP: [(&str, u16, &str); 4] = [
    ("23505", 409, "Resource already exists"),
    ("23503", 400, "Referenced resource does not exist"),
    ("23502", 400, "Required field is missing"),
    ("42501", 403, "Insufficient permissions"),
];

// The clubs, users, schools and positions routes.
pub const CLUB_NOT_FOUND: &str = "Club not found";
pub const CANNOT_REMOVE_YOURSELF: &str = "You cannot remove yourself from the club";
pub const MEMBERS_ALWAYS_FOLLOW_CLUB: &str = "Club members always follow their own club";
pub const SAVED_CLUBS_CAP_REACHED: &str = "Maximum saved clubs limit reached";
pub const CANNOT_DELETE_SELF: &str = "Admins cannot delete their own account";
pub const LAST_ADMIN_REQUIRED: &str = "Cannot remove the last remaining admin";
pub const USER_PROFILE_NOT_FOUND: &str = "User profile not found \u{2014} complete signup first";
pub const POSITION_NOT_FOUND: &str = "Position not found";
pub const DISCOVERY_QUERY_SCHOOL_NOT_FOUND: &str = "Query school is not registered";
pub const PROMOTER_PROGRAM_PAUSED: &str = "The promoter program is paused";
pub const PROMOTER_SCHOOL_REQUIRED: &str = "Choose a school before creating a promoter poster";
pub const PROMOTER_TOS_REQUIRED: &str = "You must accept the promoter terms to enroll";
pub const USER_HAS_PAYOUTS: &str = "Users with payout records cannot be deleted";
pub const USER_HAS_PROMOTER_POSTERS: &str = "Users with promoter posters cannot be deleted";
pub const USER_HAS_PAYOUT_REVIEWS: &str = "Users with payout review records cannot be deleted";

// Events (`api/events`, `api/routes/events.rs` and its neighbours).
pub const EVENT_NOT_FOUND: &str = "Event not found";
pub const REPORT_NOT_FOUND: &str = "Report not found";
pub const CALENDAR_FEED_NOT_FOUND: &str = "Calendar feed not found";
pub const CLUB_EVENT_CREATION_REQUIRED: &str =
    "Only approved club owners can create events for their club";
pub const INVALID_STATUS_TRANSITION: &str = "Invalid status transition";
pub const EVENT_ALREADY_PAST: &str = "Event has already ended and cannot be modified";
pub const GOING_EVENTS_CAP_REACHED: &str = "Maximum going events limit reached";
pub const INVALID_EVENT_OCCURRENCE: &str = "One or more occurrences do not belong to this event";
pub const OCCURRENCE_NOT_SELECTABLE: &str = "One or more occurrences can no longer be selected";
pub const CLUB_PENDING_REVIEW: &str =
    "This club is still awaiting review. You can publish events once it is approved.";

// The qr and payouts routes.
pub const POSTER_NOT_FOUND: &str = "Poster not found";
pub const PAYOUT_NOT_FOUND: &str = "Payout not found";
pub const ID_MISMATCH: &str = "ID mismatch";
pub const REQUIRES_LOCATION: &str = "requires_location";
pub const PROMOTER_ENROLLMENT_REQUIRED: &str = "Promoter enrollment is required";
pub const PROMOTER_POSTER_LIMIT_REACHED: &str = "Maximum active promoter poster limit reached";
pub const PROMOTER_POSTERS_CANNOT_BE_DELETED: &str = "Promoter posters cannot be deleted";
pub const PROMOTER_POSTERS_CANNOT_BE_UPDATED: &str = "Promoter posters cannot be updated";
pub const PROMOTER_TEMPLATE_NOT_FOUND: &str = "Approved poster template not found";
pub const PROMOTER_TEMPLATE_UNAVAILABLE: &str =
    "This poster template is not available for new posters";
pub const PROMOTER_TEMPLATE_SCHOOL_MISMATCH: &str =
    "This poster template is not available for your school";
pub const INVALID_SCAN_CONFIRMATION: &str = "Invalid or expired scan confirmation";
pub const PAYOUT_NOTES_REQUIRED: &str = "Notes are required when holding or voiding a payout";
pub const PAYOUT_EXPORT_PENDING_ONLY: &str = "Only pending payouts can be exported";
pub const INVALID_PAYOUT_FILTERS: &str = "Invalid payout filter range";

// The auth, contact and sponsor submission routes.
pub const NO_REFRESH_TOKEN: &str = "No refresh token";
pub const SESSION_REFRESH_FAILED: &str = "Could not refresh session \u{2014} please log in again";
pub const FAILED_TO_SAVE_TOKEN: &str = "Unable to save verification token. Please try again later.";
pub const REGISTRATION_FAILED: &str = "Unable to complete registration. Please try again later.";
pub const SPONSOR_SUBMISSION_NOT_FOUND: &str = "Sponsor submission not found";
pub const SUBMISSION_SCHOOL_REQUIRED: &str = "Submission club school is not registered";

// Club tickets and payouts (`api/tickets` and its routes).
pub const PAID_TICKETS_DISABLED: &str = "Paid tickets aren't available yet";
pub const TICKETS_REQUIRE_CLUB: &str = "Only an event hosted by a club can have tickets";
pub const PAYOUTS_NOT_READY: &str = "Finish setting up payouts before selling tickets";
pub const TICKETS_NOT_AVAILABLE: &str = "This event doesn't have tickets";
pub const TICKETS_PAUSED: &str = "Tickets are paused for this event";
pub const TICKETS_CLOSED: &str = "Tickets for this date are no longer available";
pub const TICKETS_SOLD_OUT: &str = "There aren't enough tickets left for this date";
pub const TICKET_DATE_NOT_FOUND: &str = "That date isn't part of this event";
pub const TICKETED_EVENT_CANCELLED: &str = "This event was cancelled";
pub const TICKET_QUANTITY_TOO_HIGH: &str = "That's more tickets than one order allows";
pub const TICKET_PRICE_OUT_OF_RANGE: &str = "Enter a ticket price within the allowed range";
pub const TICKET_CAPACITY_TOO_HIGH: &str = "That capacity is too high";
pub const TICKET_PRICE_LOCKED: &str = "The price can't change once people have tickets";
pub const TICKET_CAPACITY_BELOW_ISSUED: &str =
    "Capacity can't be lower than the tickets already taken for a date";
pub const TICKET_CAPACITY_BELOW_GOING: &str =
    "Capacity can't be lower than the people already going to a date";
pub const TICKETS_ALREADY_TAKEN: &str =
    "People already have tickets for this event. Pause tickets instead.";
pub const TICKET_REFUNDS_NEED_CANCELLATION: &str = "Cancel the event first to refund every ticket";
pub const EVENT_HAS_PAID_TICKETS: &str =
    "This event has sold tickets. Cancel it instead, and every buyer is refunded.";
pub const TICKETED_EVENT_CLUB_LOCKED: &str =
    "An event with tickets stays with the club running them";
pub const TICKETED_DATE_IN_USE: &str =
    "A date with sold tickets can't be removed. Refund those tickets first.";
pub const TICKET_NOT_FOUND: &str = "Ticket not found";
pub const TICKET_ORDER_NOT_FOUND: &str = "Order not found";
pub const TICKET_ALREADY_REFUNDED: &str = "This ticket was already refunded";
pub const TICKET_ALREADY_USED: &str = "This ticket was already used at the door";
pub const TICKET_REFUND_ALREADY_DECLINED: &str =
    "The club already declined a refund for this ticket";
pub const TICKET_REFUND_NOT_REQUESTED: &str = "Nobody asked for a refund on this ticket";
pub const FREE_TICKET_NOT_REFUNDABLE: &str = "A free ticket has nothing to refund";
pub const PAID_TICKET_NOT_RETURNABLE: &str =
    "A paid ticket can't be given back. Ask the club for a refund instead.";
pub const USER_HAS_TICKET_ORDERS: &str = "Users who bought tickets cannot be deleted";
pub const CLUB_SELLS_TICKETS: &str = "Clubs that sell tickets cannot be deleted";
pub const PAYMENT_PROVIDER_UNAVAILABLE: &str =
    "Payments are unavailable right now. Please try again in a minute.";
pub const STRIPE_SIGNATURE_INVALID: &str = "Invalid Stripe signature";
