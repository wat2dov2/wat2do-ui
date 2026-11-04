//! The digest's paging and failures, run as the real page script under Node with a
//! fake `fetch` that answers from recorded page shapes (no secrets: made-up IDs).
//! Like the Brave worker's script tests, they are skipped where Node is missing.

use std::path::PathBuf;
use std::process::Stdio;

use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};

use super::*;
use crate::controlbox::INSTAGRAM_DIGEST;
use crate::instagram_notifications::errors::SessionKind;
use crate::lightpanda::browser::Page;

const RECIPIENT: &str = "41553815702";

/// A page whose scripts run in one Node process: `window`, `document.cookie` and a
/// `fetch` that answers each request with the next of `pages` and records it.
struct NodePage {
    _child: Child,
    stdin: ChildStdin,
    stdout: Lines<BufReader<ChildStdout>>,
}

const HARNESS: &str = r#"
const readline = require("readline");
const setup = JSON.parse(process.argv[1]);
global.window = {};
global.document = {cookie: setup.cookie};
const requests = [];
global.__requests = requests;
global.fetch = (url, options) => {
  const body = new URLSearchParams(options.body);
  const variables = JSON.parse(body.get("variables"));
  requests.push({url, credentials: options.credentials, csrf: options.headers["x-csrftoken"],
    name: options.headers["x-fb-friendly-name"], cache: variables.request.cache_ent_id,
    cursor: variables.request.max_id});
  if (setup.hang) return new Promise(() => {});
  const page = setup.endless
    ? {status: 200, body: {data: {subscription_digest_feed: {
        items: [{media: {id: `${requests.length}000_1`}}],
        paging_info: {more_available: true, max_id: `cursor-${requests.length}`}}}}}
    : setup.pages[Math.min(requests.length, setup.pages.length) - 1];
  return Promise.resolve({status: page.status, ok: page.status >= 200 && page.status < 300,
    json: async () => page.body});
};
readline.createInterface({input: process.stdin}).on("line", async line => {
  let reply;
  try {
    let value = (0, eval)(JSON.parse(line));
    if (value && typeof value.then === "function") value = await value;
    reply = {value: value === undefined ? null : value};
  } catch (error) {
    reply = {error: String(error)};
  }
  process.stdout.write(JSON.stringify(reply) + "\n");
});
"#;

/// The `node` executable on PATH.
fn node() -> Option<PathBuf> {
    std::env::split_paths(&std::env::var_os("PATH")?)
        .map(|directory| directory.join("node"))
        .find(|candidate| candidate.is_file())
}

impl NodePage {
    /// None (the test is skipped) where Node is not installed.
    fn start(setup: Value) -> Option<Self> {
        let Some(node) = node() else {
            eprintln!("Node.js unavailable; skipping the digest script test");
            return None;
        };
        let mut child = Command::new(node)
            .args(["-e", HARNESS, &setup.to_string()])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .expect("node starts");
        let stdin = child.stdin.take().unwrap();
        let stdout = BufReader::new(child.stdout.take().unwrap()).lines();
        Some(Self {
            _child: child,
            stdin,
            stdout,
        })
    }

    fn logged_in(pages: Value) -> Option<Self> {
        Self::start(
            json!({"cookie": format!("csrftoken=fixture; ds_user_id={RECIPIENT}"), "pages": pages}),
        )
    }

    async fn requests(&mut self) -> Value {
        self.evaluate("__requests").await.unwrap()
    }
}

impl Page for NodePage {
    async fn evaluate(&mut self, expression: &str) -> anyhow::Result<Value> {
        let line = format!("{}\n", serde_json::to_string(expression)?);
        self.stdin.write_all(line.as_bytes()).await?;
        let reply: Value = serde_json::from_str(&self.stdout.next_line().await?.expect("a reply"))?;
        if let Some(error) = reply.get("error") {
            anyhow::bail!("the script threw: {error}");
        }
        Ok(reply["value"].clone())
    }
}

fn recorded_pages() -> Value {
    let fixture: Value =
        serde_json::from_str(include_str!("fixtures/digest_pages.json")).expect("fixture");
    fixture["pages"].clone()
}

fn page(status: u16, body: Value) -> Value {
    json!({"status": status, "body": body})
}

async fn resolved(page: &mut NodePage) -> BrowserResult<DigestResolution> {
    resolve(page, RECIPIENT, "wat2do.mun", " cache-1 ").await
}

/// The failure's kind and the message the worker would store.
fn failure(result: BrowserResult<DigestResolution>) -> (Option<SessionKind>, String) {
    let error = result.expect_err("the digest fails");
    let kind = [
        SessionKind::Digest,
        SessionKind::RateLimited,
        SessionKind::AccountChanged,
        SessionKind::PageUnavailable,
        SessionKind::AutomationTransient,
    ]
    .into_iter()
    .find(|kind| error.is(*kind));
    (kind, error.to_string())
}

const AUTH_REQUIRED: &str = "Instagram browser account requires human reauthorization";
const INVALID_RESPONSE: &str = "Instagram digest returned an invalid response";

#[tokio::test]
async fn recorded_pages_resolve_like_brave() {
    let Some(mut page) = NodePage::logged_in(recorded_pages()) else {
        return;
    };
    let resolution = resolved(&mut page).await.unwrap();
    // A null post and one with no identity are skipped, a partly loaded one is kept
    // through its strong ID, and a repeat across pages is listed once.
    assert_eq!(
        resolution,
        DigestResolution {
            account_username: "wat2do.mun".into(),
            media_ids: [
                "3758830211000000001",
                "3758830211000000002",
                "3758830211000000003",
                "3758830211000000004",
                "3758830211000000005"
            ]
            .map(String::from)
            .to_vec(),
            page_count: 3,
        }
    );
    let requests = page.requests().await;
    let cursors: Vec<&Value> = requests
        .as_array()
        .unwrap()
        .iter()
        .map(|request| &request["cursor"])
        .collect();
    assert_eq!(
        cursors,
        [
            &Value::Null,
            &json!("cursor-page-2"),
            &json!("cursor-page-3")
        ]
    );
    assert_eq!(requests[0]["url"], "https://i.instagram.com/graphql/query");
    assert_eq!(requests[0]["credentials"], "include");
    assert_eq!(requests[0]["csrf"], "fixture");
    assert_eq!(requests[0]["name"], "SubscriptionDigestFeedQuery");
    assert_eq!(requests[0]["cache"], "cache-1");
    // The settled request is cleared from the page.
    let left = page
        .evaluate("typeof window.__wat2doInstagramBrowserRequest")
        .await
        .unwrap();
    assert_eq!(left, "undefined");
}

#[tokio::test]
async fn http_failures_map_to_brave_reasons() {
    for (status, kind, message) in [
        (401, SessionKind::Digest, AUTH_REQUIRED),
        (403, SessionKind::Digest, AUTH_REQUIRED),
        (
            429,
            SessionKind::RateLimited,
            "Instagram digest is rate limited (HTTP 429)",
        ),
        (
            503,
            SessionKind::PageUnavailable,
            "Instagram digest is temporarily unavailable",
        ),
        (
            400,
            SessionKind::Digest,
            "Instagram digest query was rejected",
        ),
    ] {
        let Some(mut page) = NodePage::logged_in(json!([page(status, json!({}))])) else {
            return;
        };
        let found = failure(resolved(&mut page).await);
        assert_eq!(found, (Some(kind), message.to_owned()), "HTTP {status}");
    }
}

#[tokio::test]
async fn malformed_pages_are_invalid_responses() {
    let feed = |items: Value, paging: Value| {
        page(
            200,
            json!({"data": {"subscription_digest_feed": {"items": items, "paging_info": paging}}}),
        )
    };
    let cases = [
        // No feed at all.
        json!([page(200, json!({"data": {}}))]),
        // A cursor Instagram already sent.
        json!([
            feed(json!([]), json!({"more_available": true, "max_id": "same"})),
            feed(json!([]), json!({"more_available": true, "max_id": "same"}))
        ]),
        // More pages promised without a cursor.
        json!([feed(json!([]), json!({"more_available": true}))]),
        // A post whose identities disagree.
        json!([feed(
            json!([{"media": {"pk": "111", "id": "999_1"}}]),
            json!({})
        )]),
    ];
    for pages in cases {
        let Some(mut page) = NodePage::logged_in(pages.clone()) else {
            return;
        };
        let found = failure(resolved(&mut page).await);
        assert_eq!(
            found,
            (Some(SessionKind::Digest), INVALID_RESPONSE.to_owned()),
            "{pages}"
        );
    }
}

#[tokio::test]
async fn a_digest_longer_than_the_page_limit_fails() {
    let Some(mut page) = NodePage::start(json!({
        "cookie": format!("csrftoken=fixture; ds_user_id={RECIPIENT}"),
        "endless": true
    })) else {
        return;
    };
    assert_eq!(
        failure(resolved(&mut page).await).1,
        "Instagram digest did not reach its terminal page"
    );
    let requests = page.requests().await;
    assert_eq!(
        requests.as_array().unwrap().len() as i64,
        INSTAGRAM_DIGEST.maximum_pages
    );
}

#[tokio::test]
async fn a_logged_out_or_different_account_sends_nothing() {
    for (cookie, expected) in [
        (
            format!("ds_user_id={RECIPIENT}"),
            (SessionKind::Digest, AUTH_REQUIRED),
        ),
        (
            "csrftoken=fixture; ds_user_id=999".to_owned(),
            (
                SessionKind::AccountChanged,
                "Instagram browser account changed during the digest request",
            ),
        ),
    ] {
        let Some(mut page) = NodePage::start(json!({"cookie": cookie, "pages": recorded_pages()}))
        else {
            return;
        };
        let found = failure(resolved(&mut page).await);
        assert_eq!(found, (Some(expected.0), expected.1.to_owned()));
        assert_eq!(page.requests().await, json!([]));
    }
}

#[tokio::test]
async fn an_unsettled_query_is_cancelled_at_the_timeout() {
    let Some(mut page) = NodePage::start(json!({
        "cookie": format!("csrftoken=fixture; ds_user_id={RECIPIENT}"),
        "hang": true
    })) else {
        return;
    };
    let settled = query(
        &mut page,
        &scripts::digest_query("cache-1", RECIPIENT),
        Duration::from_millis(10),
        Duration::from_millis(100),
    )
    .await;
    assert!(settled.unwrap_err().is_timeout());
    // The abandoned request is cleared from the page.
    let left = page
        .evaluate("typeof window.__wat2doInstagramBrowserRequest")
        .await
        .unwrap();
    assert_eq!(left, "undefined");
}

#[tokio::test]
async fn an_invalid_cache_id_never_reaches_the_page() {
    let Some(mut page) = NodePage::logged_in(recorded_pages()) else {
        return;
    };
    for cache in ["", "has space", &"x".repeat(256)] {
        let found = failure(resolve(&mut page, RECIPIENT, "wat2do.mun", cache).await);
        assert_eq!(
            found,
            (
                Some(SessionKind::Digest),
                "Instagram digest cache ID is invalid".to_owned()
            )
        );
    }
    assert_eq!(page.requests().await, json!([]));
}
