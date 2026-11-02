//! Ported from the Python test suite.

use std::io::Write;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};

use serde_json::{Value, json};

use super::*;
use crate::instagram_notifications::browser_session::{
    BrowserInstagramSession, JavascriptRunner, PinnedRunner,
};
use crate::instagram_notifications::test_support::{FakeHost, ScriptedRunner, bridge, queue};

const RECIPIENT: &str = "12342599092";
const ACCOUNT: &str = "ubc.wat2do.io";
const URL: &str = "https://www.instagram.com/p/AbC/";
const ENDPOINT: &str = "/api/v1/media/1730/info/";

fn post() -> Value {
    json!({
        "url": URL,
        "ownerUsername": "club",
        "timestamp": "2026-10-04T12:00:00+00:00",
        "caption": "Workshop with snacks",
        "type": "Sidecar",
        "coauthors": [{"username": "cohost"}],
        "childPosts": [
            {"displayUrl": "https://s.cdninstagram.com/one.jpg"},
            {
                "type": "Video",
                "displayUrl": "https://s.cdninstagram.com/two.jpg",
                "videoUrl": "https://s.cdninstagram.com/two.mp4",
            },
        ],
    })
}

#[test]
fn test_rejects_nonpublic_or_credentialed_targets() {
    for url in [
        "https://evil.com/p/AbC/",
        "https://www.instagram.com/p/AbC/?cookie=x",
        "https://user@www.instagram.com/club/",
        "http://instagram.com/club/",
    ] {
        let error = canonical_target_url(url).unwrap_err();
        assert!(matches!(error, BrowserError::Value(_)), "{url}: {error:?}");
    }
}

/// A pinned tab that runs scripted page answers: what a secondary read tab needs to
/// defer an unconfirmed cleanup to its batch owner.
struct SecondaryTab {
    page: ScriptedRunner,
    tab: PinnedRunner,
}

impl JavascriptRunner for SecondaryTab {
    fn run(&mut self, source: &str, timeout: f64) -> BrowserResult<String> {
        self.page.run(source, timeout)
    }

    fn navigate(&mut self, url: &str, timeout: f64, reload: bool) -> Option<BrowserResult<String>> {
        self.page.navigate(url, timeout, reload)
    }

    fn pinned(&mut self) -> Option<&mut PinnedRunner> {
        Some(&mut self.tab)
    }
}

type Answer = dyn FnMut(&str) -> Option<BrowserResult<String>> + Send;
type Navigate = dyn FnMut(&str, bool) -> BrowserResult<String> + Send;

/// What the page did: every source it ran and every native navigation.
struct Page {
    sources: Arc<Mutex<Vec<String>>>,
    navigations: Arc<Mutex<Vec<(String, bool)>>>,
}

/// Python's `SimpleNamespace` sessions: a real session on the target post where
/// `ACCOUNT` is logged in. `answer` sees every source first; anything it leaves (None)
/// gets the page default. Native navigation goes to `navigate`.
fn page_session_with(
    secondary: bool,
    mut answer: Box<Answer>,
    mut navigate: Box<Navigate>,
) -> (BrowserInstagramSession, Page) {
    let navigations = Arc::new(Mutex::new(Vec::new()));
    let navigated = navigations.clone();
    let runner = ScriptedRunner::new(move |source| {
        if let Some(answer) = answer(source) {
            return answer;
        }
        Ok(if source == scripts::CANCEL_REQUEST {
            "settled".to_owned()
        } else if source == scripts::CLEAR_REQUEST {
            "cleared".to_owned()
        } else if source == scripts::CURRENT_ACCOUNT_USERNAME {
            ACCOUNT.to_owned()
        } else if source == scripts::PAGE_RESPONSE {
            json!({"path": "/p/AbC/", "rate_limited": false}).to_string()
        } else {
            panic!("unexpected page source: {source}")
        })
    })
    .with_navigation(move |url, reload| {
        navigated.lock().unwrap().push((url.to_owned(), reload));
        navigate(url, reload)
    });
    let page = Page {
        sources: runner.sources.clone(),
        navigations,
    };
    let host = FakeHost::idle();
    let bridge = bridge(&host);
    let session = if secondary {
        let tab = PinnedRunner::tab(&bridge, "fixture-tab");
        let runner = SecondaryTab { page: runner, tab };
        BrowserInstagramSession::new(bridge, Box::new(runner), false, None)
    } else {
        BrowserInstagramSession::new(bridge, Box::new(runner), true, None)
    };
    (session, page)
}

fn page_session(
    answer: impl FnMut(&str) -> Option<BrowserResult<String>> + Send + 'static,
) -> (BrowserInstagramSession, Page) {
    page_session_with(false, Box::new(answer), Box::new(|_, _| Ok(String::new())))
}

fn is_query(source: &str, username: &str) -> bool {
    source == scripts::public_media_query(ENDPOINT, username, false)
}

/// The query for `username` and the request state it settles with.
fn query_answer(source: &str, username: &str, payload: &Value) -> Option<BrowserResult<String>> {
    if is_query(source, username) {
        return Some(Ok("started".to_owned()));
    }
    (source == scripts::REQUEST_STATE)
        .then(|| Ok(json!({"result": payload, "settled": true}).to_string()))
}

/// A page logged in as `wat2do.ca` whose query returns `payload`.
fn canadian_session(payload: Value) -> (BrowserInstagramSession, Page) {
    page_session(move |source| {
        if source == scripts::CURRENT_ACCOUNT_USERNAME {
            return Some(Ok("wat2do.ca".to_owned()));
        }
        query_answer(source, "wat2do.ca", &payload)
    })
}

/// Python's sessions without `activate_account`: retrieval never switches accounts.
fn assert_never_switched(page: &Page) {
    assert!(
        !page
            .sources
            .lock()
            .unwrap()
            .iter()
            .any(|source| source == scripts::ACCOUNT_CHOOSER_STATE)
    );
}

#[test]
fn test_verified_browser_result_preserves_carousel_video_and_coauthors() {
    let (mut session, page) = canadian_session(json!({"state": "succeeded", "posts": [post()]}));
    let result = retrieve(&mut session, URL, 1).unwrap();
    assert_eq!(result["account_username"], json!("wat2do.ca"));
    assert_eq!(*page.navigations.lock().unwrap(), [(URL.to_owned(), true)]);
    assert_eq!(result["posts"][0], post());
    assert_eq!(media_id_from_url(URL).unwrap(), (27 * 64 + 2).to_string());
    assert_never_switched(&page);
}

#[test]
fn test_same_target_reload_refreshes_cached_account_before_readiness_and_query() {
    let username = Arc::new(Mutex::new("wat2do.previous".to_owned()));
    let (read, reloaded) = (username.clone(), username.clone());
    let payload = json!({"state": "succeeded", "posts": [post()]});
    let (mut session, page) = page_session_with(
        false,
        Box::new(move |source| {
            if source == scripts::CURRENT_ACCOUNT_USERNAME {
                return Some(Ok(read.lock().unwrap().clone()));
            }
            if is_query(source, ACCOUNT) {
                assert_eq!(*read.lock().unwrap(), ACCOUNT);
            }
            query_answer(source, ACCOUNT, &payload)
        }),
        Box::new(move |_, reload| {
            if reload {
                *reloaded.lock().unwrap() = ACCOUNT.to_owned();
            }
            Ok(String::new())
        }),
    );
    let result = retrieve(&mut session, URL, 1).unwrap();
    assert_eq!(*page.navigations.lock().unwrap(), [(URL.to_owned(), true)]);
    assert_eq!(result["account_username"], json!(ACCOUNT));
}

#[test]
fn test_verified_failed_429_is_not_lost_to_a_later_loading_identity() {
    let mut queried = false;
    let payload = json!({"state": "failed", "reason": "http_error", "http_status": 429});
    let (mut session, _) = page_session(move |source| {
        if source == scripts::CURRENT_ACCOUNT_USERNAME {
            return Some(if queried {
                Err(BrowserError::Timeout(
                    "The post-query navigation identity is still loading".to_owned(),
                ))
            } else {
                Ok(ACCOUNT.to_owned())
            });
        }
        if is_query(source, ACCOUNT) {
            queried = true;
        }
        query_answer(source, ACCOUNT, &payload)
    });
    let error = retrieve(&mut session, URL, 1).unwrap_err();
    assert!(error.is(SessionKind::RateLimited), "{error:?}");
    assert!(error.to_string().contains("HTTP 429"));
}

#[test]
fn test_account_identity_wait_detects_a_fresh_native_429() {
    for rate_limit_phase in ["before_query", "after_query"] {
        let mut path_reads = 0;
        let queries = Arc::new(Mutex::new(0));
        let counted = queries.clone();
        let payload = json!({"state": "succeeded", "posts": [post()]});
        let (mut session, _) = page_session(move |source| {
            if source == scripts::CURRENT_PATH {
                panic!("readiness must check the page response");
            }
            if source == scripts::PAGE_RESPONSE {
                path_reads += 1;
                let limited = path_reads
                    == if rate_limit_phase == "before_query" {
                        2
                    } else {
                        3
                    };
                return Some(Ok(
                    json!({"path": "/p/AbC/", "rate_limited": limited}).to_string()
                ));
            }
            if is_query(source, ACCOUNT) {
                *counted.lock().unwrap() += 1;
            }
            query_answer(source, ACCOUNT, &payload)
        });
        let error = retrieve(&mut session, URL, 1).unwrap_err();
        assert!(error.is(SessionKind::RateLimited), "{error:?}");
        assert!(error.to_string().contains("HTTP 429"));
        assert_eq!(
            *queries.lock().unwrap(),
            usize::from(rate_limit_phase == "after_query")
        );
    }
}

#[test]
fn test_incomplete_or_mismatched_media_fails() {
    for mutation in [
        "wrong_media",
        "empty_carousel",
        "missing_video",
        "bad_host",
        "naive_time",
    ] {
        let mut post = post();
        match mutation {
            "wrong_media" => post["url"] = json!("https://www.instagram.com/p/AbD/"),
            "empty_carousel" => post["childPosts"] = json!([]),
            "missing_video" => {
                post["childPosts"][1]
                    .as_object_mut()
                    .unwrap()
                    .remove("videoUrl");
            }
            "bad_host" => post["childPosts"][0]["displayUrl"] = json!("https://evil.com/file"),
            _ => post["timestamp"] = json!("2026-10-04T12:00:00"),
        }
        let (mut session, page) = canadian_session(json!({"state": "succeeded", "posts": [post]}));
        let error = retrieve(&mut session, URL, 1).unwrap_err();
        assert!(error.is_session(), "{mutation}: {error:?}");
        assert_never_switched(&page);
    }
}

/// The `node` executable on PATH, like Python's `shutil.which("node")`.
fn node() -> Option<std::path::PathBuf> {
    std::env::split_paths(&std::env::var_os("PATH")?)
        .map(|directory| directory.join("node"))
        .find(|path| path.is_file())
}

/// Run `script` in Node and return its output; None (the Python skip) without Node.
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

/// Python patched `_current_account_username_source` to `identity`.
fn query_source_with_identity(identity: &str) -> String {
    scripts::public_media_query(ENDPOINT, "wat2do.ca", false)
        .replace(scripts::CURRENT_ACCOUNT_USERNAME, identity)
}

#[test]
fn test_browser_projects_only_public_fields_and_keeps_all_carousel_children() {
    let source = query_source_with_identity(r#""wat2do.ca""#);
    let media = json!({
        "code": "AbC",
        "taken_at": 1791115200,
        "media_type": 8,
        "user": {"username": "club", "private_internal_field": "not-exported"},
        "caption": {"text": "Full caption"},
        "coauthor_producers": [{"username": "cohost"}],
        "carousel_media": [
            {
                "media_type": 1,
                "image_versions2": {
                    "candidates": [
                        {"url": "https://s.cdninstagram.com/one.jpg", "width": 100, "height": 100}
                    ]
                },
            },
            {
                "media_type": 2,
                "image_versions2": {
                    "candidates": [
                        {"url": "https://s.cdninstagram.com/two.jpg", "width": 100, "height": 100}
                    ]
                },
                "video_versions": [
                    {"url": "https://s.cdninstagram.com/two.mp4", "width": 100, "height": 100}
                ],
            },
        ],
    });
    let script = format!(
        "globalThis.window = {{}};
    globalThis.fetch = async () => ({{ok:true,json:async()=>({body})}});
    {source};
    setTimeout(() => console.log(JSON.stringify(window.__wat2doInstagramBrowserRequest.result)),0);
    ",
        body = json!({"items": [media]}),
    );
    let Some(output) = run_node(&script) else {
        return;
    };
    let result: Value = serde_json::from_str(&output).unwrap();
    let post = &result["posts"][0];
    assert_eq!(post["type"], json!("Sidecar"));
    assert_eq!(post["caption"], json!("Full caption"));
    assert!(
        post["childPosts"][1]["videoUrl"]
            .as_str()
            .unwrap()
            .ends_with("two.mp4")
    );
    assert_eq!(post["coauthors"], json!([{"username": "cohost"}]));
    assert!(!output.contains("private_internal_field"));
    validate_post(post).unwrap();
}

#[test]
fn test_browser_failure_projection_exports_only_fixed_reason_and_safe_http_status() {
    let mut cases: Vec<(&str, Value, &str)> = Vec::new();
    for status in [
        json!(400),
        json!(401),
        json!(403),
        json!(429),
        json!(503),
        json!(0),
        json!(600),
        json!(403.5),
        json!("do-not-export"),
    ] {
        cases.push(("http", status, "http_error"));
    }
    cases.extend([
        ("json", json!(200), "invalid_json"),
        ("media", json!(200), "invalid_media"),
        ("projection", json!(200), "projection_failed"),
        ("network", Value::Null, "request_failed"),
        ("account_before", Value::Null, "account_changed"),
        ("account_after", json!(200), "account_changed"),
    ]);
    for (scenario, status, reason) in cases {
        let identity = match scenario {
            "account_before" => r#""wat2do.other""#,
            "account_after" => r#"(++window.identityReads === 1 ? "wat2do.ca" : "wat2do.other")"#,
            _ => r#""wat2do.ca""#,
        };
        let source = query_source_with_identity(identity);
        let items = if scenario == "media" {
            "null"
        } else {
            r#"[{code: "AbC", taken_at: "do-not-export", user: {username: "club"}}]"#
        };
        let script = format!(
            r#"
globalThis.window = {{identityReads: 0}};
let calls = 0;
globalThis.fetch = async () => {{
  calls += 1;
  if ({scenario_json} === "network") throw new Error("do-not-export");
  return {{ok: {ok}, status: {status}, json: async () => {{
    if ({scenario_json} === "json") throw new Error("do-not-export");
    return {{items: {items}}};
  }}}};
}};
{source};
setTimeout(() => console.log(JSON.stringify({{result: window.__wat2doInstagramBrowserRequest.result,
  settled: window.__wat2doInstagramBrowserRequest.settled, calls}})), 0);
"#,
            scenario_json = json!(scenario),
            ok = scenario != "http",
        );
        let Some(output) = run_node(&script) else {
            return;
        };
        let result: Value = serde_json::from_str(&output).unwrap();
        let mut expected = json!({"state": "failed", "reason": reason});
        if scenario == "http"
            && let Some(code) = status.as_i64().filter(|code| (100..=599).contains(code))
        {
            expected["http_status"] = json!(code);
        }
        assert_eq!(result["result"], expected, "{scenario} {status}");
        assert_eq!(result["settled"], json!(true));
        assert_eq!(
            result["calls"],
            json!(if scenario == "account_before" { 0 } else { 1 })
        );
        assert!(!output.contains("do-not-export"));
    }
}

#[test]
fn test_classified_public_response_failures_preserve_bounded_read_retry_type() {
    for (reason, status, message) in [
        (json!("account_changed"), Value::Null, "account changed"),
        (json!("http_error"), json!(400), "HTTP 400"),
        (json!("http_error"), json!(401), "HTTP 401"),
        (json!("http_error"), json!(403), "HTTP 403"),
        (json!("http_error"), json!(429), "HTTP 429"),
        (json!("invalid_json"), json!(200), "not valid JSON"),
        (json!("invalid_media"), Value::Null, "media list"),
        (json!("projection_failed"), Value::Null, "projection failed"),
        (json!("request_failed"), Value::Null, "request failed"),
        (
            json!("http_error"),
            json!("do-not-export"),
            "request was rejected",
        ),
        (json!("http_error"), json!(true), "request was rejected"),
        (json!("http_error"), json!(999), "request was rejected"),
        (json!(["do-not-export"]), Value::Null, "retrieval failed"),
    ] {
        let rate_limited = reason == json!("http_error") && status == json!(429);
        let payload = json!({"state": "failed", "reason": reason, "http_status": status});
        let (mut session, _) = page_session(move |source| query_answer(source, ACCOUNT, &payload));
        let error = retrieve(&mut session, URL, 1).unwrap_err();
        let kind = if rate_limited {
            SessionKind::RateLimited
        } else {
            SessionKind::PageUnavailable
        };
        assert!(error.is(kind), "{reason} {status}: {error:?}");
        assert!(error.to_string().contains(message), "{error}");
        assert!(!error.to_string().contains("do-not-export"));
    }
}

/// Python built the pending error by hand. Here a secondary read tab produces it: the
/// request finishes with `payload` but never settles, the next state read fails with
/// `original`, and the cleanup cannot be confirmed. Returns the deferred error's parts.
fn deferred(original: BrowserError, payload: Value) -> (Option<BrowserError>, Option<Value>) {
    let mut started = false;
    let mut states = 0;
    let (mut session, _) = page_session_with(
        true,
        Box::new(move |source| {
            if is_query(source, ACCOUNT) {
                started = true;
                return Some(Ok("started".to_owned()));
            }
            if source == scripts::REQUEST_STATE {
                states += 1;
                return Some(if states == 1 {
                    Ok(json!({"result": payload, "settled": false}).to_string())
                } else {
                    Err(original.clone())
                });
            }
            (started && source == scripts::CANCEL_REQUEST)
                .then(|| Err(BrowserError::session("Brave did not answer")))
        }),
        Box::new(|_, _| Ok(String::new())),
    );
    let error = retrieve(&mut session, URL, 1).unwrap_err();
    let BrowserError::ReadCleanupPending {
        message,
        operation_error,
        completed_payload,
    } = error
    else {
        panic!("expected a deferred cleanup, got {error:?}");
    };
    assert!(message.contains("cancellation could not be confirmed"));
    (operation_error.map(|error| *error), completed_payload)
}

fn assert_same_error(actual: &BrowserError, expected: &BrowserError) {
    assert_eq!(actual.type_name(), expected.type_name());
    assert_eq!(actual.to_string(), expected.to_string());
}

#[test]
fn test_retrieval_preserves_original_human_recovery_error_and_deferred_payload() {
    let original = BrowserError::session("Instagram browser requires human account recovery");
    let payload = json!({"state": "failed", "reason": "http_error", "http_status": 401});
    let (operation_error, completed_payload) = deferred(original.clone(), payload.clone());
    assert_same_error(&operation_error.expect("operation error kept"), &original);
    assert_eq!(completed_payload, Some(payload));
}

/// Python's `operation_error=None` case cannot arise from a real session (a query
/// without an operation error has settled, so it never defers cleanup).
#[test]
fn test_confirmed_deferred_429_preserves_human_account_and_interrupt_errors() {
    let payload = json!({"state": "failed", "reason": "http_error", "http_status": 429});
    for original in [
        BrowserError::page_unavailable("Read timed out"),
        BrowserError::transient("Bridge timed out"),
        BrowserError::Timeout(String::new()),
        BrowserError::session("Instagram browser requires human account recovery"),
        BrowserError::account_changed("Account changed"),
        BrowserError::session("Invalid request state"),
        BrowserError::Interrupted,
    ] {
        let (operation_error, completed_payload) = deferred(original.clone(), payload.clone());
        let operation_error = operation_error.expect("operation error kept");
        let promoted = original.is(SessionKind::PageUnavailable)
            || original.is(SessionKind::AutomationTransient)
            || original.is_timeout();
        if promoted {
            assert!(
                operation_error.is(SessionKind::RateLimited),
                "{operation_error:?}"
            );
            assert!(operation_error.to_string().contains("HTTP 429"));
        } else {
            assert_same_error(&operation_error, &original);
        }
        assert_eq!(completed_payload, Some(payload.clone()));
    }
}

/// Python left `operation_error` as None and asserted it stayed None. A real deferred
/// query always carries one, so this uses a promotable read failure and asserts it is
/// not replaced by a rate limit.
#[test]
fn test_deferred_payload_requires_the_exact_verified_429_contract() {
    for payload in [
        json!({"state": "failed", "reason": "http_error", "http_status": "429"}),
        json!({"state": "failed", "reason": "projection_failed", "http_status": 429}),
        json!({"state": "succeeded", "reason": "http_error", "http_status": 429}),
    ] {
        let original = BrowserError::page_unavailable("Read timed out");
        let (operation_error, _) = deferred(original.clone(), payload);
        assert_same_error(&operation_error.expect("operation error kept"), &original);
    }
}

#[test]
fn test_suspended_account_stops_before_switch_or_fetch() {
    let (mut session, page) = page_session_with(
        false,
        Box::new(|_| None),
        Box::new(|_, _| {
            Err(BrowserError::session(
                "Instagram browser requires human account recovery",
            ))
        }),
    );
    let error = retrieve(&mut session, URL, 1).unwrap_err();
    assert!(error.is_session());
    assert!(error.to_string().contains("human account recovery"));
    assert!(page.sources.lock().unwrap().is_empty());
}

#[test]
fn test_retrieval_rejects_account_change() {
    let mut names = ["wat2do.ca", "wat2do.ca", "wat2do.sfu", "wat2do.sfu"].into_iter();
    let payload = json!({"state": "succeeded", "posts": [post()]});
    let (mut session, _) = page_session(move |source| {
        if source == scripts::CURRENT_ACCOUNT_USERNAME {
            return Some(Ok(names.next().expect("a name is left").to_owned()));
        }
        query_answer(source, "wat2do.ca", &payload)
    });
    let error = retrieve(&mut session, URL, 1).unwrap_err();
    assert!(error.is_session());
    assert!(error.to_string().contains("changed"), "{error}");
}

#[test]
fn test_excluded_account_remains_pending_while_other_retrieval_runs() {
    let directory = tempfile::tempdir().unwrap();
    let queue = queue(directory.path(), &FakeHost::idle());
    let held = queue
        .enqueue_retrieval("utsc", RECIPIENT, "wat2do.utsc", URL, 1)
        .unwrap();
    let allowed = queue
        .enqueue_retrieval("ubc", RECIPIENT, ACCOUNT, URL, 1)
        .unwrap();
    queue
        .set_setting("excluded_accounts", json!(["wat2do.utsc"]))
        .unwrap();
    assert_eq!(queue.claim_next(None, true).unwrap().unwrap().id, allowed);
    assert_eq!(queue.get(&held).unwrap().unwrap().state, "pending");
    assert!(queue.claim_next(None, true).unwrap().is_none());
}

#[test]
fn test_exclusions_apply_to_account_bound_jobs() {
    for kind in ["digest", "engagement"] {
        let directory = tempfile::tempdir().unwrap();
        let queue = queue(directory.path(), &FakeHost::idle());
        let job_id = if kind == "digest" {
            queue
                .enqueue_digest(RECIPIENT, "wat2do.utsc", "example")
                .unwrap()
                .id
        } else {
            queue
                .enqueue_engagement("utsc", RECIPIENT, "wat2do.utsc", URL, None, false)
                .unwrap()
        };
        queue
            .set_setting("excluded_accounts", json!(["wat2do.utsc"]))
            .unwrap();
        assert!(queue.claim_next(None, true).unwrap().is_none(), "{kind}");
        assert_eq!(queue.get(&job_id).unwrap().unwrap().state, "pending");
        queue.set_setting("excluded_accounts", json!([])).unwrap();
        assert_eq!(queue.claim_next(None, true).unwrap().unwrap().id, job_id);
    }
}

#[test]
fn test_manual_targets_preserve_exact_posts_and_normalize_handles() {
    for (target, expected) in [
        (
            "https://www.instagram.com/p/DeHr2BlJhZ6/",
            "https://www.instagram.com/p/DeHr2BlJhZ6/",
        ),
        (
            "https://instagram.com/p/DeHr2BlJhZ6/",
            "https://www.instagram.com/p/DeHr2BlJhZ6/",
        ),
        ("Some.Club", "https://www.instagram.com/some.club/"),
        (" @Some.Club ", "https://www.instagram.com/some.club/"),
        (
            "https://www.instagram.com/Some.Club/",
            "https://www.instagram.com/some.club/",
        ),
    ] {
        assert_eq!(canonical_target_url(target).unwrap(), expected);
    }
}
