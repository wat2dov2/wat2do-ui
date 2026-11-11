//! Every AppleScript and JavaScript source the worker runs in Brave.
//!
//! The files under `scripts/` are the sources Python ran, byte for byte, plus the
//! Following read (`following_query.js`), which is Rust's own. Templates mark
//! interpolated values with `@@NAME@@`; values are inserted in one pass (an inserted
//! value is never scanned again) and JSON values are encoded as Python's `json.dumps`.

use crate::controlbox::{INSTAGRAM_DIGEST, SCRAPING, instagram_browser};
use crate::pyjson;

pub const VIEWPORT: &str = include_str!("scripts/viewport.js");
pub const LOGGED_OUT: &str = include_str!("scripts/logged_out.js");
pub const LOGIN_PAGE: &str = include_str!("scripts/login_page.js");
pub const LOGIN_FORM_STATE: &str = include_str!("scripts/login_form_state.js");
/// Accept Instagram's one-tap "Save" prompt after a login.
pub const SAVE_LOGIN: &str = include_str!("scripts/save_login.js");
pub const SERVER_LOGIN: &str = include_str!("scripts/server_login.js");
pub const PAGE_RESPONSE: &str = include_str!("scripts/page_response.js");
pub const EXECUTE_TAB: &str = include_str!("scripts/execute_tab.applescript");
pub const NAVIGATE_TAB: &str = include_str!("scripts/navigate_tab.applescript");
pub const ACTIVATE_TAB: &str = include_str!("scripts/activate_tab.applescript");
pub const RESTORE_ACTIVE_TAB: &str = include_str!("scripts/restore_active_tab.applescript");
pub const OPEN_WORKER_WINDOW: &str = include_str!("scripts/open_worker_window.applescript");
pub const FRONT_APPLICATION: &str = include_str!("scripts/front_application.jxa.js");
pub const LIVE_WORKER_TABS: &str = include_str!("scripts/live_worker_tabs.applescript");
pub const WORKER_WINDOW: &str = include_str!("scripts/worker_window.applescript");
pub const CLOSE_WORKER_TAB: &str = include_str!("scripts/close_worker_tab.applescript");
pub const CANCEL_REQUEST: &str = include_str!("scripts/cancel_request.js");
pub const REQUEST_STATE: &str = include_str!("scripts/request_state.js");
pub const CLEAR_REQUEST: &str = include_str!("scripts/clear_request.js");
pub const OPEN_MORE: &str = include_str!("scripts/open_more.js");
pub const SWITCH_BUTTON_STATE: &str = include_str!("scripts/switch_button_state.js");
pub const CLICK_SWITCH_ACCOUNTS: &str = include_str!("scripts/click_switch_accounts.js");
pub const ACCOUNT_CHOOSER_STATE: &str = include_str!("scripts/account_chooser_state.js");
pub const CURRENT_ACCOUNT_USERNAME: &str = include_str!("scripts/current_account_username.js");
pub const CLOSE_ACCOUNT_CHOOSER: &str = include_str!("scripts/close_account_chooser.js");
pub const REPOST_ACTIVE_PATH: &str = include_str!("scripts/repost_active_path.txt");
pub const REPOST_INACTIVE_PATH: &str = include_str!("scripts/repost_inactive_path.txt");
/// The page-level key of the worker's one asynchronous request.
pub const REQUEST_KEY: &str = "__wat2doInstagramBrowserRequest";
pub const CURRENT_PATH: &str = "window.location.pathname";
pub const RELOAD: &str = "window.location.reload(); 1";
pub const INSTAGRAM_HOME_URL: &str = "https://www.instagram.com/";

const CLICK_ACCOUNT: &str = include_str!("scripts/click_account.js");
const RECIPIENT_IS_ACTIVE: &str = include_str!("scripts/recipient_is_active.js");
const CLICK_LABEL: &str = include_str!("scripts/click_label.js");
const SUBMIT_LOGIN: &str = include_str!("scripts/submit_login.js");
const SUBMIT_CODE: &str = include_str!("scripts/submit_code.js");
const POST_CONTEXT: &str = include_str!("scripts/post_context.js");
const DIGEST_QUERY: &str = include_str!("scripts/digest_query.js");
const ENGAGEMENT: &str = include_str!("scripts/engagement.js");
const PUBLIC_MEDIA_QUERY: &str = include_str!("scripts/public_media_query.js");
const FOLLOWING_QUERY: &str = include_str!("scripts/following_query.js");

/// Fill `@@NAME@@` placeholders from `values` in a single pass.
fn render(template: &str, values: &[(&str, &str)]) -> String {
    let mut out = String::with_capacity(template.len());
    let mut rest = template;
    while let Some(start) = rest.find("@@") {
        let after = &rest[start + 2..];
        let Some(end) = after.find("@@") else {
            break;
        };
        let name = &after[..end];
        let value = values
            .iter()
            .find(|(key, _)| *key == name)
            .unwrap_or_else(|| panic!("script placeholder @@{name}@@ has no value"));
        out.push_str(&rest[..start]);
        out.push_str(value.1);
        rest = &after[end + 2..];
    }
    out.push_str(rest);
    out
}

fn json(text: &str) -> String {
    pyjson::string(text)
}

/// `_click_account_source`: select the switcher entry for `username`.
pub fn click_account(username: &str) -> String {
    let school = username.strip_prefix("wat2do.").unwrap_or(username);
    let control = instagram_browser();
    let switcher = control
        .school_switcher_username_overrides
        .get(school)
        .map(String::as_str)
        .unwrap_or(username);
    render(
        CLICK_ACCOUNT,
        &[
            ("USERNAME", &json(username)),
            ("SWITCHER_USERNAME", &json(switcher)),
        ],
    )
}

/// `_recipient_is_active_source`: whether the page's login is `recipient_id`.
pub fn recipient_is_active(recipient_id: &str) -> String {
    render(
        RECIPIENT_IS_ACTIVE,
        &[("RECIPIENT_ID", &json(recipient_id))],
    )
}

/// `_click_label_source`: click the one button labelled exactly `text`.
pub fn click_label(text: &str) -> String {
    render(CLICK_LABEL, &[("TEXT", &json(&text.to_lowercase()))])
}

/// `_submit_login_source`: fill the login form and press Log in.
pub fn submit_login(username: &str, password: &str) -> String {
    render(
        SUBMIT_LOGIN,
        &[("USERNAME", &json(username)), ("PASSWORD", &json(password))],
    )
}

/// `_submit_code_source`: enter an emailed security code.
pub fn submit_code(code: &str) -> String {
    render(SUBMIT_CODE, &[("CODE", &json(code))])
}

/// `_post_context_source`: the unique toolbar of the visible target post.
pub fn post_context(post_url: &str) -> String {
    render(POST_CONTEXT, &[("POST_URL", &json(post_url))])
}

/// `_navigation_source`: navigate from the page, deferred so the Apple Event returns first.
pub fn navigation(url: &str) -> String {
    format!(
        "setTimeout(() => window.location.assign({}), 0); 1",
        json(url)
    )
}

/// The home page assignment `recover_login` starts from.
pub fn assign_home() -> String {
    format!("window.location.assign({}); 1", json(INSTAGRAM_HOME_URL))
}

/// `_applescript_string`: a quoted AppleScript literal.
pub fn applescript_string(text: &str) -> String {
    let escaped = text
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', " ");
    format!("\"{escaped}\"")
}

/// The execute script with `source` written into it, for sources that hold a password.
pub fn execute_tab_with_source(source: &str) -> String {
    EXECUTE_TAB.replace(
        "set javascriptSource to item 2 of argv",
        &format!("set javascriptSource to {}", applescript_string(source)),
    )
}

/// The `window.open` source that opens a worker popup at `initial_url`.
pub fn open_popup(initial_url: &str) -> String {
    format!(
        "window.open({}, '_blank', 'popup,noopener,width={},height={}');1",
        json(initial_url),
        instagram_browser().primary_minimum_viewport_width + 256,
        instagram_browser().worker_window_height
    )
}

/// `_digest_query_source`: page through one CacheEntID's digest feed inside the tab.
pub fn digest_query(cache_ent_id: &str, recipient_id: &str) -> String {
    let recipient = recipient_is_active(recipient_id);
    render(
        DIGEST_QUERY,
        &[
            ("REQUEST_KEY", &json(REQUEST_KEY)),
            ("MAXIMUM_PAGES", &INSTAGRAM_DIGEST.maximum_pages.to_string()),
            ("RECIPIENT_IS_ACTIVE", &recipient),
            ("CACHE_ENT_ID", &json(cache_ent_id)),
            ("CLIENT_DOC_ID", &json(&INSTAGRAM_DIGEST.client_doc_id)),
            ("ENDPOINT_URL", &json(&INSTAGRAM_DIGEST.endpoint_url)),
            ("WEB_APP_ID", &json(&INSTAGRAM_DIGEST.web_app_id)),
            ("OPERATION_NAME", &json(&INSTAGRAM_DIGEST.operation_name)),
        ],
    )
}

/// `_engagement_source`: inspect, and with `click` press, one action on the post.
pub fn engagement(
    recipient_id: &str,
    username: &str,
    post_url: &str,
    action: &str,
    click: bool,
) -> String {
    render(
        ENGAGEMENT,
        &[
            ("POST_CONTEXT", &post_context(post_url)),
            ("CURRENT_ACCOUNT_USERNAME", CURRENT_ACCOUNT_USERNAME),
            ("USERNAME", &json(username)),
            ("RECIPIENT_IS_ACTIVE", &recipient_is_active(recipient_id)),
            ("ACTION", &json(action)),
            ("REPOST_ACTIVE_PATH", &json(REPOST_ACTIVE_PATH)),
            ("REPOST_INACTIVE_PATH", &json(REPOST_INACTIVE_PATH)),
            ("CLICK", if click { "true" } else { "false" }),
        ],
    )
}

/// `_query_source`: fetch one public profile or post and project only public fields.
pub fn public_media_query(endpoint: &str, username: &str, profile: bool) -> String {
    let limit = if profile {
        instagram_browser().profile_post_limit
    } else {
        1
    };
    render(
        PUBLIC_MEDIA_QUERY,
        &[
            ("REQUEST_KEY", &json(REQUEST_KEY)),
            ("CURRENT_ACCOUNT_USERNAME", CURRENT_ACCOUNT_USERNAME),
            ("USERNAME", &json(username)),
            ("ENDPOINT", &json(endpoint)),
            ("WEB_APP_ID", &json(&SCRAPING.instagram_web_app_id)),
            (
                "PROFILE_OWNER",
                if profile {
                    "body.data?.user?.username"
                } else {
                    "null"
                },
            ),
            (
                "MEDIA_LIST",
                if profile {
                    "body.data?.user?.edge_owner_to_timeline_media?.edges?.map(e => e.node)"
                } else {
                    "body.items"
                },
            ),
            ("POST_LIMIT", &limit.to_string()),
        ],
    )
}

/// One page of `username`'s Following list, read as `account`: the page `max_id` names,
/// or the first. Without `user_id` the account's ID is looked up from its name first.
pub fn following_query(
    account: &str,
    username: &str,
    user_id: Option<&str>,
    max_id: Option<&str>,
) -> String {
    let optional = |value: Option<&str>| value.map_or_else(|| "null".to_owned(), json);
    render(
        FOLLOWING_QUERY,
        &[
            ("REQUEST_KEY", &json(REQUEST_KEY)),
            ("CURRENT_ACCOUNT_USERNAME", CURRENT_ACCOUNT_USERNAME),
            ("ACCOUNT", &json(account)),
            ("USERNAME", &json(username)),
            ("USER_ID", &optional(user_id)),
            ("MAX_ID", &optional(max_id)),
            (
                "PAGE_SIZE",
                &instagram_browser().following_page_size.to_string(),
            ),
            ("WEB_APP_ID", &json(&SCRAPING.instagram_web_app_id)),
        ],
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rendering_never_rescans_inserted_values() {
        assert_eq!(
            render("a @@X@@ b @@Y@@", &[("X", "@@Y@@"), ("Y", "y")]),
            "a @@Y@@ b y"
        );
    }

    #[test]
    fn applescript_strings_escape_quotes_backslashes_and_newlines() {
        assert_eq!(applescript_string("a\"b\\c\nd"), "\"a\\\"b\\\\c d\"");
    }
}
