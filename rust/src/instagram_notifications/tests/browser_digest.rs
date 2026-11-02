//! Ported from the Python test suite.

use std::io::Write;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};

use serde_json::{Value, json};

use super::*;
use crate::instagram_notifications::browser_session::{
    ACCOUNT_UNAVAILABLE, BrowserInstagramSession, JavascriptRunner, PinnedRunner,
};
use crate::instagram_notifications::test_support::{FakeHost, ScriptedRunner, bridge};

const RECIPIENT: &str = "41553815702";
const ACCOUNT: &str = "usask.wat2do.io";
const CACHE_ID: &str = "cache-1";

#[test]
fn test_digest_media_count_treats_under_count_as_advisory() {
    assert_eq!(digest_media_count_shortfall(155, Some(156)).unwrap(), 1);
    assert_eq!(digest_media_count_shortfall(156, Some(156)).unwrap(), 0);
    assert_eq!(digest_media_count_shortfall(155, None).unwrap(), 0);
}

#[test]
fn test_digest_media_count_rejects_over_count() {
    let error = digest_media_count_shortfall(157, Some(156)).unwrap_err();
    assert!(error.is(SessionKind::Digest));
    assert!(
        error
            .to_string()
            .contains("resolved more media IDs than advertised")
    );
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

    fn pinned(&mut self) -> Option<&mut PinnedRunner> {
        Some(&mut self.tab)
    }
}

/// Python's `FakeSession`: a real session on a page where the intended account is
/// active. `answer` sees every source first; anything it leaves (None) gets the
/// default for an idle page. Returns the session and every source it ran.
fn page_session(
    secondary: bool,
    mut answer: impl FnMut(&str) -> Option<BrowserResult<String>> + Send + 'static,
) -> (BrowserInstagramSession, Arc<Mutex<Vec<String>>>) {
    let recipient_active = scripts::recipient_is_active(RECIPIENT);
    let page = ScriptedRunner::new(move |source| {
        if let Some(answer) = answer(source) {
            return answer;
        }
        Ok(if source == scripts::CANCEL_REQUEST {
            "settled".to_owned()
        } else if source == scripts::CLEAR_REQUEST {
            "cleared".to_owned()
        } else if source == scripts::CURRENT_ACCOUNT_USERNAME {
            ACCOUNT.to_owned()
        } else if source == recipient_active {
            "true".to_owned()
        } else if source == scripts::ACCOUNT_CHOOSER_STATE {
            "closed".to_owned()
        } else {
            panic!("unexpected page source: {source}")
        })
    });
    let sources = page.sources.clone();
    let host = FakeHost::idle();
    let bridge = bridge(&host);
    let session = if secondary {
        let tab = PinnedRunner::tab(&bridge, "fixture-tab");
        BrowserInstagramSession::new(bridge, Box::new(SecondaryTab { page, tab }), false, None)
    } else {
        BrowserInstagramSession::new(bridge, Box::new(page), true, None)
    };
    (session, sources)
}

/// The digest query source and the request state it settles with.
fn query_answer(source: &str, payload: &Value) -> Option<BrowserResult<String>> {
    if source == scripts::digest_query(CACHE_ID, RECIPIENT) {
        return Some(Ok("started".to_owned()));
    }
    (source == scripts::REQUEST_STATE)
        .then(|| Ok(json!({"result": payload, "settled": true}).to_string()))
}

fn fake_session(payload: Value) -> (BrowserInstagramSession, Arc<Mutex<Vec<String>>>) {
    page_session(false, move |source| query_answer(source, &payload))
}

fn default_payload() -> Value {
    json!({"state": "succeeded", "media_ids": ["123", "456"], "page_count": 1})
}

#[test]
fn test_digest_reuses_shared_session_and_returns_only_media_identities() {
    let (mut session, sources) = fake_session(default_payload());
    let result = resolve(&mut session, RECIPIENT, "USASK.wat2do.io", CACHE_ID).unwrap();
    assert_eq!(
        result,
        DigestResolution {
            account_username: ACCOUNT.to_owned(),
            media_ids: vec!["123".to_owned(), "456".to_owned()],
            page_count: 1,
        }
    );
    let sources = sources.lock().unwrap();
    // The account was activated for the intended recipient before the query.
    let activated = sources
        .iter()
        .position(|source| *source == scripts::recipient_is_active(RECIPIENT))
        .expect("recipient verified");
    let query = sources
        .iter()
        .position(|source| *source == scripts::digest_query(CACHE_ID, RECIPIENT))
        .expect("digest queried");
    assert!(activated < query);
    assert!(!sources[query].to_lowercase().contains("sessionid"));
}

#[test]
fn test_session_error_keeps_digest_public_error_contract() {
    let (mut session, _) = page_session(false, |source| {
        (source == scripts::CURRENT_ACCOUNT_USERNAME)
            .then(|| Err(BrowserError::session(ACCOUNT_UNAVAILABLE)))
    });
    let error = resolve(&mut session, RECIPIENT, ACCOUNT, CACHE_ID).unwrap_err();
    assert!(error.is(SessionKind::Digest), "{error:?}");
    assert!(error.to_string().contains("account is unavailable"));
}

#[test]
fn test_digest_preserves_recoverable_session_failure_type() {
    for kind in [
        SessionKind::AccountChanged,
        SessionKind::RateLimited,
        SessionKind::AutomationTransient,
        SessionKind::PageUnavailable,
        SessionKind::TabUnavailable,
    ] {
        let error = BrowserError::of(kind, "Recoverable browser failure");
        let raised = error.clone();
        let (mut session, _) = page_session(false, move |source| {
            (source == scripts::digest_query(CACHE_ID, RECIPIENT)).then(|| Err(raised.clone()))
        });
        let result = resolve(&mut session, RECIPIENT, ACCOUNT, CACHE_ID).unwrap_err();
        assert!(result.is(kind), "{result:?}");
        assert_eq!(result.to_string(), error.to_string());
    }
}

#[test]
fn test_digest_response_uses_typed_recoverable_failure() {
    for (reason, kind) in [
        ("account_changed", SessionKind::AccountChanged),
        ("rate_limited", SessionKind::RateLimited),
        ("temporarily_unavailable", SessionKind::PageUnavailable),
        ("request_failed", SessionKind::PageUnavailable),
    ] {
        let (mut session, _) = fake_session(json!({"state": "failed", "reason": reason}));
        let error = resolve(&mut session, RECIPIENT, ACCOUNT, CACHE_ID).unwrap_err();
        assert!(error.is(kind), "{reason}: {error:?}");
    }
}

/// Python built the pending error by hand. Here a secondary read tab produces it: the
/// request finishes with a 429 but never settles, the next state read fails with
/// `original`, and the cleanup cannot be confirmed.
///
/// Python's `operation_error=None` case cannot arise from a real session (a query
/// without an operation error has settled, so it never defers cleanup).
#[test]
fn test_deferred_digest_429_keeps_original_human_account_and_interrupt_causes() {
    let payload = json!({"state": "failed", "reason": "rate_limited"});
    for original in [
        BrowserError::page_unavailable("Transient page failure"),
        BrowserError::transient("Transient bridge failure"),
        BrowserError::Timeout("Transient readiness timeout".to_owned()),
        BrowserError::session("Instagram browser requires human account recovery"),
        BrowserError::account_changed("The active account changed"),
        BrowserError::Interrupted,
    ] {
        let raised = original.clone();
        let unsettled = payload.clone();
        let mut started = false;
        let mut states = 0;
        let (mut session, _) = page_session(true, move |source| {
            if source == scripts::digest_query(CACHE_ID, RECIPIENT) {
                started = true;
                return Some(Ok("started".to_owned()));
            }
            if source == scripts::REQUEST_STATE {
                states += 1;
                return Some(if states == 1 {
                    Ok(json!({"result": unsettled, "settled": false}).to_string())
                } else {
                    Err(raised.clone())
                });
            }
            (started && source == scripts::CANCEL_REQUEST)
                .then(|| Err(BrowserError::session("Brave did not answer")))
        });
        let error = resolve(&mut session, RECIPIENT, ACCOUNT, CACHE_ID).unwrap_err();
        let BrowserError::ReadCleanupPending {
            message,
            operation_error,
            completed_payload,
        } = error
        else {
            panic!("expected a deferred cleanup, got {error:?}");
        };
        assert!(message.contains("cancellation could not be confirmed"));
        assert_eq!(completed_payload, Some(payload.clone()));
        let operation_error = operation_error.expect("operation error kept");
        let promoted = original.is(SessionKind::PageUnavailable)
            || original.is(SessionKind::AutomationTransient)
            || original.is_timeout();
        if promoted {
            assert!(
                operation_error.is(SessionKind::RateLimited),
                "{operation_error:?}"
            );
        } else {
            assert_eq!(operation_error.type_name(), original.type_name());
            assert_eq!(operation_error.to_string(), original.to_string());
        }
    }
}

/// The `node` executable on PATH, like Python's `shutil.which("node")`.
fn node() -> Option<std::path::PathBuf> {
    std::env::split_paths(&std::env::var_os("PATH")?)
        .map(|directory| directory.join("node"))
        .find(|path| path.is_file())
}

/// Run `script` in Node and parse its JSON output; None (the Python skip) without Node.
fn run_node(script: &str) -> Option<Value> {
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
    Some(serde_json::from_slice(&completed.stdout).expect("JSON output"))
}

fn request_key() -> String {
    json!(scripts::REQUEST_KEY).to_string()
}

#[test]
fn test_digest_http_failure_has_one_safe_reason_and_terminal_settlement() {
    for (status, reason) in [
        (429, "rate_limited"),
        (503, "temporarily_unavailable"),
        (401, "auth_required"),
    ] {
        let script = format!(
            "global.window = {{}};\
             global.document = {{cookie: \"csrftoken=private; ds_user_id=41553815702\"}};\
             global.fetch = async () => ({{status: {status}, ok: false}});\
             {source};setImmediate(() => {{const request = window[{key}]; \
             console.log(JSON.stringify({{result: request.result, settled: request.settled}}));}});",
            source = scripts::digest_query(CACHE_ID, RECIPIENT),
            key = request_key(),
        );
        if let Some(result) = run_node(&script) {
            assert_eq!(
                result,
                json!({"result": {"state": "failed", "reason": reason}, "settled": true})
            );
        }
    }
}

#[test]
fn test_digest_rejects_bad_or_failed_results() {
    for payload in [
        json!({"state": "succeeded", "media_ids": ["123", "123"], "page_count": 1}),
        json!({"state": "succeeded", "media_ids": ["123"], "page_count": true}),
        json!({"state": "succeeded", "media_ids": ["123"], "page_count": 0}),
        json!({"state": "succeeded", "media_ids": ["invalid"], "page_count": 1}),
        json!({"state": "failed", "reason": "auth_required"}),
    ] {
        let (mut session, _) = fake_session(payload.clone());
        let error = resolve(&mut session, RECIPIENT, ACCOUNT, CACHE_ID).unwrap_err();
        assert!(error.is(SessionKind::Digest), "{payload}: {error:?}");
    }
}

#[test]
fn test_digest_stops_pagination_when_account_changes_after_first_page() {
    let script = format!(
        r#"
      global.window = {{}};
      global.document = {{cookie: "csrftoken=fixture; ds_user_id=41553815702"}};
      let fetches = 0;
      global.fetch = async () => {{
        fetches += 1;
        return {{status: 200, ok: true, json: async () => ({{data: {{
          subscription_digest_feed: {{
            items: [{{media: {{get pk() {{
              document.cookie = "csrftoken=fixture; ds_user_id=999";
              return "123";
            }}}}}}],
            paging_info: {{more_available: true, max_id: "page-2"}}
          }}
        }}}})}};
      }};
    {source};setImmediate(() => {{const request = window[{key}]; console.log(JSON.stringify({{result: request.result, settled: request.settled, fetches}}));}});"#,
        source = scripts::digest_query(CACHE_ID, RECIPIENT),
        key = request_key(),
    );
    if let Some(result) = run_node(&script) {
        assert_eq!(
            result,
            json!({
                "result": {"state": "failed", "reason": "account_changed"},
                "settled": true,
                "fetches": 1,
            })
        );
    }
}

#[test]
fn test_digest_aborts_inflight_fetch_before_account_can_change() {
    let script = format!(
        r#"
      global.window = {{}};
      global.document = {{cookie: "csrftoken=private; ds_user_id=41553815702"}};
      let aborted = false;
      global.fetch = (_url, options) => new Promise((_resolve, reject) => {{
        options.signal.addEventListener("abort", () => {{
          aborted = true;
          reject(new Error("aborted"));
        }});
      }});
    {source};
const first = {cancel};
      setImmediate(() => {{
        const second = {cancel};
        console.log(JSON.stringify({{aborted, first, second}}));
      }});
    "#,
        source = scripts::digest_query(CACHE_ID, RECIPIENT),
        cancel = scripts::CANCEL_REQUEST,
    );
    if let Some(result) = run_node(&script) {
        assert_eq!(
            result,
            json!({"aborted": true, "first": "pending", "second": "settled"})
        );
    }
}

#[test]
fn test_digest_skips_posts_instagram_could_not_load() {
    let cases = [
        // A post Instagram could not load is skipped; the digest keeps the rest.
        (
            json!([{"media": {"pk": "111"}}, {"media": null}, {"media": {"pk": "222"}}]),
            Some(json!(["111", "222"])),
        ),
        // A partly loaded post is kept through its "<media>_<owner>" strong ID.
        (
            json!([
                {"media": {"pk": "111"}},
                {"media": {"strong_id__": "3988328074353983199_19865977534", "context__": null}},
                {"media": {"context__": null}},
            ]),
            Some(json!(["111", "3988328074353983199"])),
        ),
        // A post whose identities disagree still fails the whole digest.
        (json!([{"media": {"pk": "111", "id": "999_1"}}]), None),
    ];
    for (items, expected) in cases {
        let script = format!(
            r#"
      global.window = {{}};
      global.document = {{cookie: "csrftoken=fixture; ds_user_id=41553815702"}};
      global.fetch = async () => ({{status: 200, ok: true, json: async () => ({{
        errors: [{{message: "execution error", severity: "ERROR"}}],
        data: {{subscription_digest_feed: {{items: {items}, paging_info: {{more_available: false}}}}}}
      }})}});
    {source};setImmediate(() => setImmediate(() => {{const request = window[{key}]; console.log(JSON.stringify(request.result));}}));"#,
            source = scripts::digest_query(CACHE_ID, RECIPIENT),
            key = request_key(),
        );
        let Some(result) = run_node(&script) else {
            continue;
        };
        match expected {
            None => assert_eq!(
                result,
                json!({"state": "failed", "reason": "invalid_response"})
            ),
            Some(media_ids) => assert_eq!(
                result,
                json!({"state": "succeeded", "media_ids": media_ids, "page_count": 1})
            ),
        }
    }
}
