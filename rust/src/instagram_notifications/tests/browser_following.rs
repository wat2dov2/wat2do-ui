//! Following reads: the page script in Node, and `read_page` on scripted pages.

use std::io::Write;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};

use serde_json::{Value, json};

use super::*;
use crate::instagram_notifications::errors::SessionKind;
use crate::instagram_notifications::test_support::{FakeHost, ScriptedRunner, bridge};

const ACCOUNT: &str = "wat2do.ca";

fn listed(username: &str, private: bool) -> Value {
    json!({"username": username, "full_name": format!("{username} club"), "pk": "4242", "is_private": private})
}

/// What a scripted page saw: the sources it ran and how many navigations it got.
type Seen = (Arc<Mutex<Vec<String>>>, Arc<Mutex<usize>>);

/// A page logged in as `names` (one per identity read) whose query settles with
/// `payload`; it records every source and navigation.
fn page(names: Vec<&'static str>, payload: Value) -> (BrowserInstagramSession, Seen) {
    let mut names = names.into_iter();
    let mut last = ACCOUNT;
    let navigations = Arc::new(Mutex::new(0));
    let navigated = navigations.clone();
    let runner = ScriptedRunner::new(move |source| {
        Ok(if source == scripts::CANCEL_REQUEST {
            "settled".to_owned()
        } else if source == scripts::CLEAR_REQUEST {
            "cleared".to_owned()
        } else if source == scripts::CURRENT_ACCOUNT_USERNAME {
            last = names.next().unwrap_or(last);
            last.to_owned()
        } else if source == scripts::PAGE_RESPONSE {
            json!({"path": "/wat2do.ca/", "rate_limited": false}).to_string()
        } else if source == scripts::REQUEST_STATE {
            json!({"result": payload, "settled": true}).to_string()
        } else if source.contains("/following/?") {
            "started".to_owned()
        } else {
            panic!("unexpected page source: {source}")
        })
    })
    .with_navigation(move |_, _| {
        *navigated.lock().unwrap() += 1;
        Ok(String::new())
    });
    let sources = runner.sources.clone();
    let host = FakeHost::idle();
    let session = BrowserInstagramSession::new(bridge(&host), Box::new(runner), true, None);
    (session, (sources, navigations))
}

fn read(payload: Value) -> BrowserResult<Value> {
    let (mut session, _) = page(vec![], payload);
    read_page(&mut session, "Club.One", Some("101"), Some("100"))
}

#[test]
fn a_page_keeps_only_each_accounts_name_id_and_privacy_as_the_shown_account() {
    let mut extra = listed("club.two", true);
    extra["profile_pic_url"] = json!("https://example.com/secret.jpg");
    extra["full_name"] = json!("x".repeat(300));
    let (mut session, (sources, navigations)) = page(
        vec![],
        json!({
            "state": "succeeded",
            "user_id": "101",
            "users": [listed("club.three", false), extra],
            "next_max_id": "QVFE+abc/=",
        }),
    );
    let result = read_page(&mut session, "Club.One", Some("101"), Some("100")).unwrap();
    assert_eq!(result["account_username"], json!(ACCOUNT));
    assert_eq!(result["username"], json!("club.one"));
    assert_eq!(result["user_id"], json!("101"));
    assert_eq!(result["next_max_id"], json!("QVFE+abc/="));
    assert_eq!(result["invalid"], json!(0));
    assert_eq!(result["users"][0], listed("club.three", false));
    assert_eq!(result["users"][1]["is_private"], json!(true));
    assert_eq!(
        result["users"][1]["full_name"].as_str().unwrap().len(),
        NAME_LIMIT
    );
    assert!(result["users"][1].get("profile_pic_url").is_none());
    // Never a navigation or an account switch: the read runs where the tab already is.
    assert_eq!(*navigations.lock().unwrap(), 0);
    let sources = sources.lock().unwrap();
    assert!(
        !sources
            .iter()
            .any(|source| source == scripts::ACCOUNT_CHOOSER_STATE)
    );
    assert!(sources.contains(&scripts::following_query(
        ACCOUNT,
        "club.one",
        Some("101"),
        Some("100")
    )));
}

#[test]
fn the_last_page_has_no_cursor_and_a_hidden_list_is_said_so() {
    let last =
        read(json!({"state": "succeeded", "user_id": "101", "users": [], "next_max_id": null}))
            .unwrap();
    assert_eq!(last["next_max_id"], Value::Null);
    assert_eq!(last["users"], json!([]));
    let hidden = read(json!({"state": "succeeded", "hidden": true})).unwrap();
    assert_eq!(
        hidden,
        json!({"account_username": ACCOUNT, "username": "club.one", "hidden": true})
    );
}

#[test]
fn a_429_or_a_login_wall_is_a_rate_limit_and_other_failures_keep_their_retry_kind() {
    for (payload, kind, message) in [
        (
            json!({"state": "failed", "reason": "http_error", "http_status": 429}),
            SessionKind::RateLimited,
            "HTTP 429",
        ),
        (
            json!({"state": "failed", "reason": "login_required", "http_status": 401}),
            SessionKind::RateLimited,
            "login",
        ),
        (
            json!({"state": "failed", "reason": "login_required"}),
            SessionKind::RateLimited,
            "login",
        ),
        (
            json!({"state": "failed", "reason": "blocked", "http_status": 400}),
            SessionKind::RateLimited,
            "refused",
        ),
        (
            json!({"state": "failed", "reason": "http_error", "http_status": 500}),
            SessionKind::PageUnavailable,
            "HTTP 500",
        ),
        (
            json!({"state": "failed", "reason": "http_error", "http_status": "429"}),
            SessionKind::PageUnavailable,
            "read failed",
        ),
        (
            json!({"state": "failed", "reason": "account_changed"}),
            SessionKind::PageUnavailable,
            "account changed",
        ),
        (
            json!({"state": "failed", "reason": "invalid_json", "http_status": 200}),
            SessionKind::RateLimited,
            "not valid JSON",
        ),
        (
            json!({"state": "failed", "reason": "invalid_response"}),
            SessionKind::Session,
            "account list",
        ),
        (
            json!({"state": "failed", "reason": ["do-not-export"]}),
            SessionKind::PageUnavailable,
            "read failed",
        ),
    ] {
        let error = read(payload.clone()).unwrap_err();
        assert!(error.is(kind), "{payload}: {error:?}");
        assert!(error.to_string().contains(message), "{error}");
        assert!(!error.to_string().contains("do-not-export"));
    }
}

#[test]
fn malformed_accounts_are_dropped_and_counted() {
    let page = read(json!({
        "state": "succeeded",
        "user_id": "101",
        "users": [
            listed("Bad Name", false),
            {"username": "club", "full_name": "", "pk": "", "is_private": false},
            {"username": "club", "full_name": null, "pk": "1", "is_private": false},
            "not an account",
            listed("club.kept", false),
        ],
        "next_max_id": null,
    }))
    .unwrap();
    assert_eq!(page["users"], json!([listed("club.kept", false)]));
    assert_eq!(page["invalid"], json!(4));
}

#[test]
fn a_page_without_a_list_its_id_or_a_valid_cursor_fails_the_read() {
    for payload in [
        json!({"state": "succeeded", "user_id": "101", "users": "nope", "next_max_id": null}),
        json!({"state": "succeeded", "user_id": "999", "users": [], "next_max_id": null}),
        json!({"state": "succeeded", "user_id": "101", "users": [], "next_max_id": "a b"}),
        json!({"state": "succeeded", "user_id": "101", "users": [], "next_max_id": 7}),
    ] {
        let error = read(payload.clone()).unwrap_err();
        assert!(error.is(SessionKind::Session), "{payload}: {error:?}");
    }
}

#[test]
fn an_account_switch_during_the_read_is_refused() {
    let (mut session, _) = page(
        vec![ACCOUNT, "wat2do.sfu"],
        json!({"state": "succeeded", "user_id": "101", "users": [], "next_max_id": null}),
    );
    let error = read_page(&mut session, "club.one", Some("101"), None).unwrap_err();
    assert!(error.is(SessionKind::AccountChanged), "{error:?}");
}

#[test]
fn owners_and_cursors_are_checked_before_anything_runs() {
    assert_eq!(validate_list_owner(" Club.One ").unwrap(), "club.one");
    for owner in ["", "bad name", "a/b", &"a".repeat(31)] {
        assert!(validate_list_owner(owner).is_err(), "{owner}");
    }
    assert_eq!(validate_cursor("QVFE_-+/=:|.1").unwrap(), "QVFE_-+/=:|.1");
    for cursor in ["", "a b", "a&b", "a?b", &"a".repeat(1025)] {
        assert!(validate_cursor(cursor).is_err(), "{cursor}");
    }
}

/// The `node` executable on PATH; tests that need it are skipped without it.
fn node() -> Option<std::path::PathBuf> {
    std::env::split_paths(&std::env::var_os("PATH")?)
        .map(|directory| directory.join("node"))
        .find(|path| path.is_file())
}

/// Run `script` in Node and return its output; None without Node.
fn run_node(script: &str) -> Option<String> {
    let Some(node) = node() else {
        eprintln!("skipped: Node.js unavailable");
        return None;
    };
    let mut child = Command::new(node)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("node starts");
    child
        .stdin
        .take()
        .expect("stdin")
        .write_all(script.as_bytes())
        .expect("script written");
    let completed = child.wait_with_output().expect("node finishes");
    assert!(
        completed.status.success(),
        "{}",
        String::from_utf8_lossy(&completed.stderr)
    );
    Some(String::from_utf8(completed.stdout).expect("utf-8 output"))
}

/// Run the page script with the logged-in identity `identity` (a JavaScript expression)
/// against `responses`, a JavaScript array of `[status, body, url]` answers; prints the
/// settled request and every request the page made.
fn run_query(
    identity: &str,
    user_id: Option<&str>,
    max_id: Option<&str>,
    responses: &str,
) -> Option<Value> {
    let source = scripts::following_query(ACCOUNT, "club.one", user_id, max_id)
        .replace(scripts::CURRENT_ACCOUNT_USERNAME, identity);
    let script = format!(
        r#"
globalThis.window = {{identityReads: 0}};
const responses = {responses};
const requests = [];
globalThis.fetch = async (path, options) => {{
  requests.push({{path, credentials: options.credentials, headers: options.headers}});
  const answer = responses.shift();
  if (answer === "network") throw new Error("do-not-export");
  const [status, body, url] = answer;
  return {{ok: status >= 200 && status < 300, status, url: url ?? "https://www.instagram.com" + path,
    json: async () => {{ if (body === "not-json") throw new Error("do-not-export"); return body; }}}};
}};
{source};
setTimeout(() => console.log(JSON.stringify({{result: window.__wat2doInstagramBrowserRequest.result,
  settled: window.__wat2doInstagramBrowserRequest.settled, requests}})), 0);
"#
    );
    run_node(&script).map(|output| serde_json::from_str(&output).unwrap())
}

#[test]
fn the_page_reads_one_following_page_with_the_web_apps_headers_and_projects_only_public_fields() {
    let body = json!({
        "users": [
            {"pk": 7, "username": "Club.Two", "full_name": "Club Two", "is_private": false,
             "profile_pic_url": "do-not-export", "friendship_status": {"following": true}},
            {"pk_id": "8", "username": "personal", "full_name": null, "is_private": true},
        ],
        "big_list": true,
        "page_size": 100,
        "next_max_id": 200,
        "status": "ok",
    });
    let Some(output) = run_query(
        r#""wat2do.ca""#,
        Some("101"),
        Some("100"),
        &format!("[[200, {body}]]"),
    ) else {
        return;
    };
    assert_eq!(
        output["result"],
        json!({
            "state": "succeeded",
            "user_id": "101",
            "users": [
                {"username": "club.two", "full_name": "Club Two", "pk": "7", "is_private": false},
                {"username": "personal", "full_name": "", "pk": "8", "is_private": true},
            ],
            "next_max_id": "200",
        })
    );
    assert_eq!(output["settled"], json!(true));
    let size = crate::controlbox::instagram_browser().following_page_size;
    assert_eq!(
        output["requests"],
        json!([{
            "path": format!("/api/v1/friendships/101/following/?count={size}&max_id=100"),
            "credentials": "include",
            "headers": {"x-ig-app-id": crate::controlbox::SCRAPING.instagram_web_app_id, "x-requested-with": "XMLHttpRequest"},
        }])
    );
    assert!(!output.to_string().contains("do-not-export"));
}

#[test]
fn the_page_looks_an_unknown_id_up_by_name_first() {
    let profile = json!({"data": {"user": {"id": "101", "username": "club.one"}}});
    let page = json!({"users": [], "status": "ok"});
    let Some(output) = run_query(
        r#""wat2do.ca""#,
        None,
        None,
        &format!("[[200, {profile}], [200, {page}]]"),
    ) else {
        return;
    };
    assert_eq!(
        output["result"],
        json!({"state": "succeeded", "user_id": "101", "users": [], "next_max_id": null})
    );
    let size = crate::controlbox::instagram_browser().following_page_size;
    let paths: Vec<&str> = output["requests"]
        .as_array()
        .unwrap()
        .iter()
        .map(|request| request["path"].as_str().unwrap())
        .collect();
    assert_eq!(
        paths,
        [
            "/api/v1/users/web_profile_info/?username=club.one".to_owned(),
            format!("/api/v1/friendships/101/following/?count={size}"),
        ]
    );
}

#[test]
fn the_page_reports_only_fixed_reasons_and_safe_statuses() {
    let login = "https://www.instagram.com/accounts/login/?next=x";
    for (identity, user_id, responses, expected, requests) in [
        (
            r#""wat2do.other""#,
            Some("101"),
            "[]",
            json!({"state": "failed", "reason": "account_changed"}),
            0,
        ),
        (
            r#"(++window.identityReads === 1 ? "wat2do.ca" : "wat2do.other")"#,
            Some("101"),
            r#"[[200, {"users": []}]]"#,
            json!({"state": "failed", "reason": "account_changed"}),
            1,
        ),
        (
            r#""wat2do.ca""#,
            Some("101"),
            r#"[[429, "not-json"]]"#,
            json!({"state": "failed", "reason": "http_error", "http_status": 429}),
            1,
        ),
        (
            r#""wat2do.ca""#,
            Some("101"),
            r#"[[401, {}]]"#,
            json!({"state": "failed", "reason": "login_required", "http_status": 401}),
            1,
        ),
        (
            r#""wat2do.ca""#,
            Some("101"),
            &format!(r#"[[200, "not-json", "{login}"]]"#),
            json!({"state": "failed", "reason": "login_required", "http_status": 200}),
            1,
        ),
        (
            r#""wat2do.ca""#,
            Some("101"),
            r#"[[403, {"message": "checkpoint_required", "do-not-export": 1}]]"#,
            json!({"state": "failed", "reason": "login_required", "http_status": 403}),
            1,
        ),
        (
            r#""wat2do.ca""#,
            Some("101"),
            r#"[[200, {"require_login": true}]]"#,
            json!({"state": "failed", "reason": "login_required", "http_status": 200}),
            1,
        ),
        (
            r#""wat2do.ca""#,
            Some("101"),
            r#"[[400, {"message": "Not authorized to view user"}]]"#,
            json!({"state": "succeeded", "hidden": true}),
            1,
        ),
        (
            r#""wat2do.ca""#,
            Some("101"),
            r#"[[400, {"message": "User not found", "status": "fail"}]]"#,
            json!({"state": "succeeded", "hidden": true}),
            1,
        ),
        (
            r#""wat2do.ca""#,
            Some("101"),
            r#"[[400, {"message": "feedback_required", "spam": true}]]"#,
            json!({"state": "failed", "reason": "blocked", "http_status": 400}),
            1,
        ),
        (
            r#""wat2do.ca""#,
            Some("101"),
            r#"[[400, {"spam": true}]]"#,
            json!({"state": "failed", "reason": "blocked", "http_status": 400}),
            1,
        ),
        (
            r#""wat2do.ca""#,
            Some("101"),
            r#"[[403, {}]]"#,
            json!({"state": "failed", "reason": "blocked", "http_status": 403}),
            1,
        ),
        (
            r#""wat2do.ca""#,
            Some("101"),
            r#"[[400, "not-json"]]"#,
            json!({"state": "failed", "reason": "blocked", "http_status": 400}),
            1,
        ),
        (
            r#""wat2do.ca""#,
            Some("101"),
            r#"[[410, {}]]"#,
            json!({"state": "failed", "reason": "blocked", "http_status": 410}),
            1,
        ),
        (
            r#""wat2do.ca""#,
            Some("101"),
            r#"[[200, {"status": "fail", "message": "Please wait a few minutes before you try again."}]]"#,
            json!({"state": "failed", "reason": "blocked", "http_status": 200}),
            1,
        ),
        (
            r#""wat2do.ca""#,
            Some("101"),
            r#"[[200, {"status": "fail", "message": "do-not-export"}]]"#,
            json!({"state": "failed", "reason": "blocked", "http_status": 200}),
            1,
        ),
        (
            r#""wat2do.ca""#,
            Some("101"),
            r#"[[200, {"checkpoint_url": "/challenge/x"}]]"#,
            json!({"state": "failed", "reason": "login_required", "http_status": 200}),
            1,
        ),
        (
            r#""wat2do.ca""#,
            None,
            r#"[[404, "not-json"]]"#,
            json!({"state": "succeeded", "hidden": true}),
            1,
        ),
        (
            r#""wat2do.ca""#,
            None,
            r#"[[200, {"data": {"user": null}}]]"#,
            json!({"state": "succeeded", "hidden": true}),
            1,
        ),
        (
            r#""wat2do.ca""#,
            None,
            r#"[[200, {"data": {"user": {"id": "do-not-export"}}}]]"#,
            json!({"state": "failed", "reason": "invalid_response"}),
            1,
        ),
        (
            r#""wat2do.ca""#,
            Some("101"),
            r#"[[503, "not-json"]]"#,
            json!({"state": "failed", "reason": "http_error", "http_status": 503}),
            1,
        ),
        (
            r#""wat2do.ca""#,
            Some("101"),
            r#"[[200, "not-json"]]"#,
            json!({"state": "failed", "reason": "invalid_json"}),
            1,
        ),
        (
            r#""wat2do.ca""#,
            Some("101"),
            r#"[[200, {"users": "do-not-export"}]]"#,
            json!({"state": "failed", "reason": "invalid_response"}),
            1,
        ),
        (
            r#""wat2do.ca""#,
            Some("101"),
            r#"["network"]"#,
            json!({"state": "failed", "reason": "request_failed"}),
            1,
        ),
    ] {
        let Some(output) = run_query(identity, user_id, None, responses) else {
            return;
        };
        assert_eq!(output["result"], expected, "{responses}");
        assert_eq!(output["settled"], json!(true));
        assert_eq!(
            output["requests"].as_array().unwrap().len(),
            requests,
            "{responses}"
        );
        assert!(!output["result"].to_string().contains("do-not-export"));
    }
}

#[test]
fn the_page_never_touches_cookies() {
    let source = scripts::following_query(ACCOUNT, "club.one", None, None);
    assert!(!source.contains("cookie"));
    assert!(!source.contains("csrf"));
}
