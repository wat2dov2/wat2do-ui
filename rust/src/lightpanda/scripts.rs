//! The JavaScript the Lightpanda login and sessions run in their page. Digests and
//! Following reads run the Brave worker's own scripts (`instagram_notifications::scripts`).

/// Where the page is and what it shows, for reading a login's outcome.
pub const PAGE_STATE: &str = include_str!("scripts/page_state.js");
/// Focus the login form's username field; "missing" when the form is not there.
pub const FOCUS_USERNAME: &str = include_str!("scripts/focus_username.js");
/// Focus the login form's password field.
pub const FOCUS_PASSWORD: &str = include_str!("scripts/focus_password.js");
/// Focus the security code field.
pub const FOCUS_CODE: &str = include_str!("scripts/focus_code.js");
/// The logged-in account's Instagram user ID (`ds_user_id`), empty when logged out.
pub const USER_ID: &str = include_str!("scripts/user_id.js");
