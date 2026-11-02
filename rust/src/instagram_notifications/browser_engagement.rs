//! Idempotent native actions on one post using the shared Brave session.
//!
//! Only visible, unambiguous controls are used. Missing native repost state is an
//! unsupported capability, never an excuse to guess whether clicking would undo it.

use serde_json::{Map, Value, json};

use super::browser_session::{BrowserInstagramSession, canonical_post_url};
use super::errors::{BrowserError, BrowserResult};
use super::scripts;
use crate::controlbox::instagram_browser;

const ACTIONS: [&str; 3] = ["like", "save", "repost"];
const DISPATCH_UNCERTAIN: &str =
    "Instagram engagement dispatch is uncertain; inspect browser state before resuming";

/// Complete one post per worker lock, verifying identity before any click.
/// Open once and finish configured actions before releasing this post's lock.
pub fn engage_post(
    session: &mut BrowserInstagramSession,
    recipient_id: &str,
    account_username: &str,
    post_url: &str,
    inspect: bool,
) -> BrowserResult<Value> {
    let url = canonical_post_url(post_url)?;
    let username = session.activate_account(recipient_id, account_username)?;
    session.navigate_post(&url, recipient_id, &username)?;
    let mut actions = Map::new();
    for action in &instagram_browser().actions {
        let state = if inspect {
            ready(session, recipient_id, &username, &url, action)?
        } else {
            let state = action_state(session, recipient_id, &username, &url, action, true)?;
            complete(session, recipient_id, &username, &url, action, state)?
        };
        actions.insert(action.clone(), state);
    }
    let unsupported = actions
        .values()
        .any(|result| result.get("status") == Some(&json!("unsupported")));
    let status = if unsupported {
        "unsupported"
    } else if inspect {
        "ready"
    } else {
        "succeeded"
    };
    Ok(json!({"status": status, "actions": actions}))
}

fn complete(
    session: &mut BrowserInstagramSession,
    recipient_id: &str,
    username: &str,
    url: &str,
    action: &str,
    result: Value,
) -> BrowserResult<Value> {
    if result.get("status") != Some(&json!("clicked")) {
        return Ok(result);
    }
    // Never click a second time. An uncertain completion requires inspection on a
    // manual retry, which can recognize an already completed action.
    let completed = session.poll_until(|session| {
        let state = action_state(session, recipient_id, username, url, action, false)?;
        match state.get("status").and_then(Value::as_str) {
            Some("already_done") => Ok(true),
            Some("unsupported") => Err(BrowserError::session(
                "Instagram action state became unavailable after clicking",
            )),
            _ => Ok(false),
        }
    });
    match completed {
        Ok(()) => Ok(json!({"action": action, "status": "succeeded"})),
        // Python's `except Exception` let interrupts through.
        Err(BrowserError::Interrupted) => Err(BrowserError::Interrupted),
        Err(_) => Err(BrowserError::uncertain(
            "Instagram engagement completion is uncertain; inspect browser state before resuming",
        )),
    }
}

fn action_state(
    session: &mut BrowserInstagramSession,
    recipient_id: &str,
    username: &str,
    post_url: &str,
    action: &str,
    click: bool,
) -> BrowserResult<Value> {
    if !ACTIONS.contains(&action) {
        return Err(BrowserError::session(
            "Instagram engagement action is invalid",
        ));
    }
    if click {
        let ready = ready(session, recipient_id, username, post_url, action)?;
        if ready.get("status") != Some(&json!("ready")) {
            return Ok(ready);
        }
    }
    let source = scripts::engagement(recipient_id, username, post_url, action, click);
    let raw = if click {
        match session.run(&source) {
            Ok(raw) => raw,
            Err(BrowserError::Interrupted) => return Err(BrowserError::Interrupted),
            Err(_) => return Err(BrowserError::uncertain(DISPATCH_UNCERTAIN)),
        }
    } else {
        session.read(&source)?
    };
    let invalid_state_message = if click {
        DISPATCH_UNCERTAIN
    } else {
        "Instagram engagement returned invalid state"
    };
    let response_error = |message: &str| {
        if click {
            BrowserError::uncertain(message)
        } else {
            BrowserError::session(message)
        }
    };
    let Ok(Value::Object(state)) = serde_json::from_str::<Value>(&raw) else {
        return Err(response_error(invalid_state_message));
    };
    let status = state.get("status");
    if status == Some(&json!("failed")) {
        return Err(BrowserError::session(failure_message(state.get("reason"))));
    }
    let Some(status) = status.and_then(Value::as_str).filter(|status| {
        [
            "ready",
            "not_ready",
            "clicked",
            "already_done",
            "unsupported",
        ]
        .contains(status)
    }) else {
        return Err(response_error(invalid_state_message));
    };
    if status == "ready" && click {
        return Err(BrowserError::uncertain(invalid_state_message));
    }
    if status == "not_ready" && click {
        return Err(BrowserError::session(failure_message(Some(&json!(
            "not_ready"
        )))));
    }
    if status == "clicked" && !click {
        return Err(BrowserError::session(
            "Instagram engagement returned invalid state",
        ));
    }
    let mut result = json!({"action": action, "status": status});
    if status == "unsupported" {
        result["reason"] =
            json!("Native repost is unavailable or has no explicit reversible state");
    }
    Ok(result)
}

fn ready(
    session: &mut BrowserInstagramSession,
    recipient_id: &str,
    username: &str,
    post_url: &str,
    action: &str,
) -> BrowserResult<Value> {
    let mut state = Value::Null;
    session.poll_until(|session| {
        state = action_state(session, recipient_id, username, post_url, action, false)?;
        Ok(state.get("status") != Some(&json!("not_ready")))
    })?;
    Ok(state)
}

fn failure_message(reason: Option<&Value>) -> &'static str {
    match reason.and_then(Value::as_str) {
        Some("wrong_account") => "Instagram browser account does not match the intended account",
        Some("wrong_post") => "Instagram browser is not on the intended post",
        Some("not_ready") => "Instagram post is not ready for engagement",
        Some("ambiguous_post") => "Instagram post container is unavailable or ambiguous",
        Some("ambiguous_toolbar") => "Instagram post action toolbar is unavailable or ambiguous",
        Some("ambiguous_control") => "Instagram post action control is unavailable or ambiguous",
        Some("unknown_state") => "Instagram post action state is unknown",
        Some("blocked") => "Instagram browser requires human attention before engagement",
        _ => "Instagram engagement failed",
    }
}

/// The Python suite's cases, ported.
#[cfg(test)]
#[path = "tests/browser_engagement.rs"]
mod python_tests;
