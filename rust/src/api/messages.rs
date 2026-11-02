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
