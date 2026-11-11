//! A Lightpanda Following read: the Brave worker's script, checked by the session's
//! user ID, and the Brave reader's page checks and refusals.

use std::process::Command;

use serde_json::{Value, json};

use super::*;
use crate::instagram_notifications::errors::SessionKind;

const ACCOUNT: &str = "wat2do.mun";
const RECIPIENT: &str = "41553815702";

/// A page that answers the read's request with `result` once it is polled.
struct FakePage {
    result: Value,
    sources: Vec<String>,
}

impl FakePage {
    fn new(result: Value) -> Self {
        Self {
            result,
            sources: Vec::new(),
        }
    }
}

impl Page for FakePage {
    async fn evaluate(&mut self, expression: &str) -> anyhow::Result<Value> {
        self.sources.push(expression.to_owned());
        Ok(if expression == scripts::REQUEST_STATE {
            Value::from(json!({"result": self.result, "settled": true}).to_string())
        } else if expression == scripts::CLEAR_REQUEST {
            Value::Null
        } else {
            json!("started")
        })
    }
}

async fn read(result: Value) -> (BrowserResult<Value>, Vec<String>) {
    let mut page = FakePage::new(result);
    let outcome = read_page(&mut page, ACCOUNT, RECIPIENT, "Club.One", Some("101"), None).await;
    (outcome, page.sources)
}

#[tokio::test]
async fn a_page_keeps_the_crawls_fields_and_names_the_session_account() {
    let (outcome, sources) = read(json!({
        "state": "succeeded",
        "user_id": "101",
        "users": [
            {"username": "member.one", "full_name": "Member", "pk": "202", "is_private": true},
            {"username": "Not Valid", "full_name": "", "pk": "x", "is_private": false}
        ],
        "next_max_id": "50"
    }))
    .await;
    let page = outcome.unwrap();
    assert_eq!(page["account_username"], ACCOUNT);
    assert_eq!(page["username"], "club.one");
    assert_eq!(page["invalid"], 1);
    assert_eq!(page["users"][0]["pk"], "202");
    assert_eq!(page["next_max_id"], "50");
    assert_eq!(
        sources[0],
        scripts::following_query_as_recipient(RECIPIENT, "club.one", Some("101"), None)
    );
}

#[tokio::test]
async fn a_hidden_list_is_said_so() {
    let (outcome, _) = read(json!({"state": "succeeded", "hidden": true})).await;
    assert_eq!(outcome.unwrap()["hidden"], true);
}

#[tokio::test]
async fn refusals_are_the_brave_readers() {
    let (outcome, _) =
        read(json!({"state": "failed", "reason": "http_error", "http_status": 429})).await;
    assert!(outcome.unwrap_err().is(SessionKind::RateLimited));
    let (outcome, _) = read(json!({"state": "failed", "reason": "login_required"})).await;
    assert!(outcome.unwrap_err().is(SessionKind::RateLimited));
    let (outcome, _) = read(json!({"state": "failed", "reason": "account_changed"})).await;
    assert!(outcome.unwrap_err().is(SessionKind::PageUnavailable));
}

#[tokio::test]
async fn an_invalid_owner_never_reaches_the_page() {
    let mut page = FakePage::new(Value::Null);
    let outcome = read_page(&mut page, ACCOUNT, RECIPIENT, "../x", None, None).await;
    assert!(outcome.is_err());
    assert!(page.sources.is_empty());
}

/// The script's account check, run under Node with `cookie` as `document.cookie`:
/// whether it read the list (true) or refused as another account (false).
fn reads_as(cookie: &str) -> Option<bool> {
    let node = std::env::split_paths(&std::env::var_os("PATH")?)
        .map(|directory| directory.join("node"))
        .find(|candidate| candidate.is_file())?;
    let source = scripts::following_query_as_recipient(RECIPIENT, "club.one", Some("101"), None);
    let script = format!(
        r#"
globalThis.window = {{}};
globalThis.document = {{cookie: {cookie}}};
globalThis.fetch = async () => ({{ok: true, status: 200, url: "https://www.instagram.com/x",
  json: async () => ({{users: [], next_max_id: null}})}});
{source};
setTimeout(() => console.log(JSON.stringify(window.__wat2doInstagramBrowserRequest.result)), 0);
"#,
        cookie = json!(cookie)
    );
    let output = Command::new(node).args(["-e", &script]).output().ok()?;
    let result: Value = serde_json::from_slice(&output.stdout).ok()?;
    Some(result["state"] == "succeeded")
}

#[test]
fn the_script_reads_only_as_the_sessions_user() {
    let Some(own) = reads_as(&format!("csrftoken=x; ds_user_id={RECIPIENT}")) else {
        eprintln!("Node.js unavailable; skipping the Following script test");
        return;
    };
    assert!(own);
    assert_eq!(reads_as("csrftoken=x; ds_user_id=999"), Some(false));
    assert_eq!(reads_as("csrftoken=x"), Some(false));
}
