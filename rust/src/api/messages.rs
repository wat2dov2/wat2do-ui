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
