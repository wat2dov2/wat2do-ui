//! Ported from the Python test suite.
//!
//! Offline DOM fixtures reflecting observed Instagram web action roles/labels. The small
//! DOM adapter exercises selectors and click behavior in Node without launching a browser
//! or contacting Instagram. It is not a live browser E2E test.

use std::io::Write;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};

use serde_json::{Map, Value, json};

use super::*;
use crate::controlbox::overrides;
use crate::instagram_notifications::browser_session::BrowserInstagramSession;
use crate::instagram_notifications::errors::SessionKind;
use crate::instagram_notifications::test_support::{FakeHost, ScriptedRunner, bridge};

const RECIPIENT: &str = "41553815702";
const ACCOUNT: &str = "usask.wat2do.io";
const URL: &str = "https://www.instagram.com/p/TARGET123/";

// --- Offline DOM fixtures -------------------------------------------------------------

/// Python's `HTMLParser` tree of the fixture: `{tag, attrs, children}` nodes, text dropped.
fn parse_fixture(html: &str) -> Value {
    fn node(tag: &str, attrs: Map<String, Value>) -> Value {
        json!({"tag": tag, "attrs": attrs, "children": []})
    }
    fn attach(stack: &mut [Value], child: Value) {
        stack.last_mut().expect("open element")["children"]
            .as_array_mut()
            .expect("children")
            .push(child);
    }
    const VOID: [&str; 6] = ["img", "input", "br", "hr", "meta", "link"];
    let mut stack = vec![node("document", Map::new())];
    let bytes = html.as_bytes();
    let mut index = 0;
    while let Some(offset) = html[index..].find('<') {
        index += offset + 1;
        if bytes[index] == b'/' {
            let end = index + html[index..].find('>').expect("closed end tag");
            let tag = html[index + 1..end].trim().to_lowercase();
            let closed = stack.pop().expect("open element");
            assert_eq!(closed["tag"], json!(tag), "fixture tags must nest");
            attach(&mut stack, closed);
            index = end + 1;
            continue;
        }
        let name_end = index
            + html[index..]
                .find(|character: char| !character.is_ascii_alphanumeric())
                .expect("tag name ends");
        let tag = html[index..name_end].to_lowercase();
        index = name_end;
        let mut attrs = Map::new();
        loop {
            while bytes[index].is_ascii_whitespace() || bytes[index] == b'/' {
                index += 1;
            }
            if bytes[index] == b'>' {
                index += 1;
                break;
            }
            let name_end = index
                + html[index..]
                    .find(|character: char| {
                        character.is_ascii_whitespace() || "=>/".contains(character)
                    })
                    .expect("attribute name ends");
            let name = html[index..name_end].to_lowercase();
            index = name_end;
            let value = if bytes[index] == b'=' {
                let quote = bytes[index + 1] as char;
                assert!(
                    quote == '"' || quote == '\'',
                    "fixture attributes are quoted"
                );
                let start = index + 2;
                let end = start + html[start..].find(quote).expect("closing quote");
                index = end + 1;
                Value::String(html[start..end].to_owned())
            } else {
                Value::Null
            };
            attrs.insert(name, value);
        }
        let element = node(&tag, attrs);
        if VOID.contains(&tag.as_str()) {
            attach(&mut stack, element);
        } else {
            stack.push(element);
        }
    }
    assert_eq!(stack.len(), 1, "fixture elements must all close");
    stack.pop().expect("document")
}

const DOM_ADAPTER: &str = r#"
const clicks = [];
class Element {
  constructor(node, parent = null) {
    this.tag = node.tag; this.attrs = node.attrs; this.parent = parent; this.parentElement = parent;
    this.children = node.children.map(child => new Element(child, this));
    this.disabled = "disabled" in this.attrs;
  }
  getAttribute(name) { return this.attrs[name] ?? null; }
  matches(selector) {
    return selector.split(",").some(choice => {
      const match = choice.match(/^([a-z0-9]+)?(?:\[([^=\]]+)(?:="([^"]*)")?\])?$/);
      if (!match) throw new Error("Unsupported fixture selector: " + choice);
      return (!match[1] || this.tag === match[1]) &&
        (!match[2] || (match[2] in this.attrs &&
          (match[3] === undefined || this.attrs[match[2]] === match[3])));
    });
  }
  querySelectorAll(selector) {
    return this.children.flatMap(child =>
      [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) {
    return this.matches(selector) ? this : (this.parent?.closest(selector) || null);
  }
  contains(node) { return this === node || this.children.some(child => child.contains(node)); }
  getBoundingClientRect() {
    return {left: this.tag === "a" ? 10 : 300, top: 10,
      width: this.attrs["data-hidden"] ? 0 : 24, height: 24};
  }
  scrollIntoView() {}
  click() { clicks.push(this.attrs.id || "anonymous"); }
}
global.getComputedStyle = () => ({visibility: "visible", display: "block"});
"#;

fn fixture_with(toolbar: &str, extra: &str, duplicate_post: bool, account: &str) -> String {
    let post = format!(
        r#"
      <article role="presentation">
        <a href="/p/TARGET123/">timestamp</a>
        <section>{toolbar}</section>
        <ul><li><button id="comment-like"><svg aria-label="Like"></svg></button></li></ul>
      </article>
    "#
    );
    let second = if duplicate_post { post.as_str() } else { "" };
    format!(
        r#"
      <nav><a href="/{account}/"><img alt="{account}'s profile picture"></a></nav>
      <div role="dialog">{post}{second}</div>{extra}
    "#
    )
}

fn fixture(toolbar: &str) -> String {
    fixture_with(toolbar, "", false, ACCOUNT)
}

#[derive(Clone, Copy)]
struct Toolbar<'a> {
    like: &'a str,
    save: &'a str,
    repost: &'a str,
    pressed: Option<&'a str>,
    extra: &'a str,
}

const TOOLBAR: Toolbar<'static> = Toolbar {
    like: "Like",
    save: "Save",
    repost: "Repost",
    pressed: None,
    extra: "",
};

fn toolbar_with(toolbar: Toolbar<'_>) -> String {
    let Toolbar {
        like,
        save,
        repost,
        pressed,
        extra,
    } = toolbar;
    let pressed_attribute = pressed.map_or(String::new(), |pressed| {
        format!(r#"aria-pressed="{pressed}""#)
    });
    format!(
        r#"
      <div role="button" id="post-like"><svg aria-label="{like}"><title>{like}</title></svg></div>
      <div role="button" id="comment"><svg aria-label="Comment"></svg></div>
      <div role="button" id="repost" {pressed_attribute}>
        <svg aria-label="{repost}"><title>{repost}</title></svg>
      </div>
      <div role="button"><svg aria-label="Share Post"></svg></div>
      <div role="button"><div role="button" id="post-save">
        <svg aria-label="{save}"><title>{save}</title></svg>
      </div></div>{extra}
    "#
    )
}

fn toolbar() -> String {
    toolbar_with(TOOLBAR)
}

fn pressed_toolbar(pressed: &str) -> String {
    toolbar_with(Toolbar {
        pressed: Some(pressed),
        ..TOOLBAR
    })
}

/// The `node` executable on PATH, like Python's `shutil.which("node")`.
fn node() -> Option<std::path::PathBuf> {
    std::env::split_paths(&std::env::var_os("PATH")?)
        .map(|directory| directory.join("node"))
        .find(|path| path.is_file())
}

/// Run `script` in Node; None (the Python skip) when Node is unavailable.
fn run_node(script: &str) -> Option<String> {
    let Some(node) = node() else {
        eprintln!("skipped: Node.js unavailable for offline DOM fixture tests");
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

fn evaluate_with(html: &str, action: &str, click: bool, path: &str, recipient: &str) -> Value {
    let Some(output) = run_node(&format!(
        "{DOM_ADAPTER}
      global.document = new Element({root});
      document.readyState = \"complete\";
      document.cookie = {cookie};
      global.window = {{location: {{origin: \"https://www.instagram.com\", pathname: {path}}}}};
      const state = {source};
      console.log(JSON.stringify({{state: JSON.parse(state), clicks}}));
    ",
        root = parse_fixture(html),
        cookie = json!(format!("ds_user_id={recipient}")),
        path = json!(path),
        source = scripts::engagement(RECIPIENT, ACCOUNT, URL, action, click),
    )) else {
        return Value::Null;
    };
    serde_json::from_str(&output).expect("JSON output")
}

fn evaluate(html: &str, action: &str, click: bool) -> Value {
    evaluate_with(html, action, click, "/p/TARGET123/", RECIPIENT)
}

/// Assert an evaluation unless Node is unavailable (Python skipped those tests).
fn assert_evaluates(result: Value, expected: Value) {
    if !result.is_null() {
        assert_eq!(result, expected);
    }
}

fn clicks(result: &Value) -> Option<&Value> {
    (!result.is_null()).then(|| &result["clicks"])
}

#[test]
fn test_targets_post_toolbar_not_comment_likes_or_nested_wrapper() {
    for (action, clicked_id) in [("like", "post-like"), ("save", "post-save")] {
        assert_evaluates(
            evaluate(&fixture(&toolbar()), action, true),
            json!({"state": {"status": "clicked"}, "clicks": [clicked_id]}),
        );
    }
}

#[test]
fn test_active_actions_are_never_toggled_off() {
    let cases = [
        (
            "like",
            Toolbar {
                like: "Unlike",
                ..TOOLBAR
            },
        ),
        (
            "save",
            Toolbar {
                save: "Remove",
                ..TOOLBAR
            },
        ),
        (
            "repost",
            Toolbar {
                repost: "Undo repost",
                ..TOOLBAR
            },
        ),
        (
            "repost",
            Toolbar {
                pressed: Some("true"),
                ..TOOLBAR
            },
        ),
    ];
    for (action, labels) in cases {
        assert_evaluates(
            evaluate(&fixture(&toolbar_with(labels)), action, true),
            json!({"state": {"status": "already_done"}, "clicks": []}),
        );
    }
}

#[test]
fn test_observed_repost_without_explicit_state_is_unsupported() {
    assert_evaluates(
        evaluate(&fixture(&toolbar()), "repost", true),
        json!({"state": {"status": "unsupported"}, "clicks": []}),
    );
}

#[test]
fn test_explicitly_inactive_native_repost_is_supported() {
    assert_evaluates(
        evaluate(&fixture(&pressed_toolbar("false")), "repost", true),
        json!({"state": {"status": "clicked"}, "clicks": ["repost"]}),
    );
}

#[test]
fn test_inspection_never_clicks() {
    for action in ["like", "save", "repost"] {
        assert_evaluates(
            evaluate(&fixture(&pressed_toolbar("false")), action, false),
            json!({"state": {"status": "ready"}, "clicks": []}),
        );
    }
}

#[test]
fn test_ambiguous_or_wrong_context_fails_without_clicking() {
    let second_like = toolbar_with(Toolbar {
        extra: r#"<button id="second"><svg aria-label="Like"></svg></button>"#,
        ..TOOLBAR
    });
    let cases = [
        (fixture(&toolbar()), "/p/WRONG/", RECIPIENT, "wrong_post"),
        (
            fixture(&toolbar()),
            "/p/TARGET123/",
            "99999",
            "wrong_account",
        ),
        (
            fixture_with(&toolbar(), "", false, "other.wat2do.io"),
            "/p/TARGET123/",
            RECIPIENT,
            "wrong_account",
        ),
        (
            fixture_with(&toolbar(), "", true, ACCOUNT),
            "/p/TARGET123/",
            RECIPIENT,
            "ambiguous_post",
        ),
        (
            fixture(&second_like),
            "/p/TARGET123/",
            RECIPIENT,
            "ambiguous_control",
        ),
        (
            fixture_with(
                &toolbar(),
                r#"<div role="dialog"><button>Challenge</button></div>"#,
                false,
                ACCOUNT,
            ),
            "/p/TARGET123/",
            RECIPIENT,
            "blocked",
        ),
    ];
    for (html, path, recipient, reason) in cases {
        assert_evaluates(
            evaluate_with(&html, "like", true, path, recipient),
            json!({"state": {"status": "failed", "reason": reason}, "clicks": []}),
        );
    }
}

#[test]
fn test_hidden_duplicate_action_is_ignored() {
    let html = fixture(&toolbar_with(Toolbar {
        extra: r#"
      <button data-hidden="yes"><svg aria-label="Like" data-hidden="yes"></svg></button>
    "#,
        ..TOOLBAR
    }));
    let result = evaluate(&html, "like", true);
    if let Some(clicks) = clicks(&result) {
        assert_eq!(clicks, &json!(["post-like"]));
    }
}

#[test]
fn test_disabled_action_is_not_ready_instead_of_a_human_block() {
    for attribute in [r#"aria-disabled="true""#, "disabled"] {
        let like = r#"<div role="button" id="post-like"><svg aria-label="Like"><title>Like</title></svg></div>"#;
        let disabled = format!(
            r#"<button id="post-like" {attribute}><svg aria-label="Like"><title>Like</title></svg></button>"#
        );
        let html = fixture(&toolbar().replace(like, &disabled));
        assert_evaluates(
            evaluate(&html, "like", false),
            json!({"state": {"status": "not_ready"}, "clicks": []}),
        );
        let result = evaluate(&html, "like", true);
        if let Some(clicks) = clicks(&result) {
            assert_eq!(clicks, &json!([]));
        }
    }
}

// --- Executor with a scripted page ----------------------------------------------------

/// What Python's `FakeSession` recorded: engagement sources by kind, plus the
/// activations and post navigations around them.
#[derive(Default)]
struct Recorded {
    mutations: Vec<String>,
    reads: Vec<String>,
    activations: usize,
    navigations: Vec<String>,
}

/// One answer per engagement call: a bare status string is `{"status": ...}`.
fn state(value: Value) -> String {
    match value {
        Value::String(status) => json!({ "status": status }).to_string(),
        other => other.to_string(),
    }
}

/// Python's `FakeSession`: a real session on a page that answers identity and
/// readiness checks for the intended account and post, and engagement sources from
/// `states` in order. A click source fails with `click_failure` when one is given.
/// Polls give three tries, like the fake's `poll_until`.
fn fake_session(
    states: Vec<Value>,
    click_failure: Option<BrowserError>,
) -> (BrowserInstagramSession, Arc<Mutex<Recorded>>) {
    overrides::instagram_browser(|control| {
        control.interaction_timeout_seconds = 3.0 * control.poll_interval_seconds;
    });
    let recorded = Arc::new(Mutex::new(Recorded::default()));
    let mut states = states.into_iter();
    let page = recorded.clone();
    let navigations = recorded.clone();
    let post_ready = format!("({}).status", scripts::post_context(URL));
    let recipient_active = scripts::recipient_is_active(RECIPIENT);
    let sources = |click: bool| -> Vec<String> {
        ACTIONS
            .iter()
            .map(|action| scripts::engagement(RECIPIENT, ACCOUNT, URL, action, click))
            .collect()
    };
    let (clicks, reads) = (sources(true), sources(false));
    let runner = ScriptedRunner::new(move |source| {
        let mut recorded = page.lock().unwrap();
        if clicks.iter().any(|click| click == source) {
            recorded.mutations.push(source.to_owned());
            if let Some(failure) = &click_failure {
                return Err(failure.clone());
            }
        } else if reads.iter().any(|read| read == source) {
            recorded.reads.push(source.to_owned());
        } else {
            return Ok(if source == scripts::CANCEL_REQUEST {
                "settled".to_owned()
            } else if source == scripts::CLEAR_REQUEST {
                "cleared".to_owned()
            } else if source == scripts::CURRENT_ACCOUNT_USERNAME {
                ACCOUNT.to_owned()
            } else if source == recipient_active {
                "true".to_owned()
            } else if source == scripts::ACCOUNT_CHOOSER_STATE {
                recorded.activations += 1;
                "closed".to_owned()
            } else if source == scripts::PAGE_RESPONSE {
                json!({"path": "/p/TARGET123/", "rate_limited": false}).to_string()
            } else if source == post_ready {
                "ready".to_owned()
            } else {
                panic!("unexpected page source: {source}")
            });
        }
        Ok(state(states.next().expect("an engagement state is left")))
    })
    .with_navigation(move |url, _reload| {
        navigations.lock().unwrap().navigations.push(url.to_owned());
        Ok(String::new())
    });
    let host = FakeHost::idle();
    let session = BrowserInstagramSession::new(bridge(&host), Box::new(runner), true, None);
    (session, recorded)
}

fn session(states: Vec<Value>) -> (BrowserInstagramSession, Arc<Mutex<Recorded>>) {
    fake_session(states, None)
}

/// Python's `_execute`: prepare once, then click and complete one action.
fn execute(session: &mut BrowserInstagramSession, action: &str) -> BrowserResult<Value> {
    let url = canonical_post_url(URL)?;
    let username = session.activate_account(RECIPIENT, ACCOUNT)?;
    session.navigate_post(&url, RECIPIENT, &username)?;
    let result = action_state(session, RECIPIENT, &username, &url, action, true)?;
    complete(session, RECIPIENT, &username, &url, action, result)
}

fn statuses(states: &[&str]) -> Vec<Value> {
    states.iter().map(|status| json!(status)).collect()
}

/// Python's `[call[0] for call in session.calls] == ["activate", "navigate"]`.
fn assert_prepared_once(recorded: &Recorded) {
    assert_eq!(recorded.activations, 1);
    assert_eq!(recorded.navigations, [URL]);
}

#[test]
fn test_executor_clicks_once_and_waits_for_positive_confirmation() {
    let (mut session, recorded) = session(statuses(&[
        "ready",
        "clicked",
        "ready",
        "not_ready",
        "already_done",
    ]));
    assert_eq!(
        execute(&mut session, "like").unwrap(),
        json!({"action": "like", "status": "succeeded"})
    );
    let recorded = recorded.lock().unwrap();
    assert_prepared_once(&recorded);
    assert_eq!(recorded.mutations.len(), 1);
    assert_eq!(recorded.reads.len(), 4);
}

#[test]
fn test_verification_timeout_does_not_click_again() {
    let (mut session, recorded) =
        session(statuses(&["ready", "clicked", "ready", "ready", "ready"]));
    let error = execute(&mut session, "like").unwrap_err();
    assert!(error.is(SessionKind::EngagementUncertain), "{error:?}");
    assert!(error.to_string().contains("completion is uncertain"));
    assert_eq!(recorded.lock().unwrap().mutations.len(), 1);
}

#[test]
fn test_uncertain_click_dispatch_is_sanitized_and_never_replayed() {
    for failure in [
        BrowserError::transient("private bridge timeout"),
        BrowserError::Timeout("private timeout".to_owned()),
        BrowserError::other("RuntimeError", "private unexpected bridge failure"),
    ] {
        let (mut session, recorded) = fake_session(statuses(&["ready"]), Some(failure));
        let error = execute(&mut session, "like").unwrap_err();
        assert!(error.is(SessionKind::EngagementUncertain), "{error:?}");
        assert!(error.to_string().contains("dispatch is uncertain"));
        assert!(!error.to_string().contains("private"));
        let recorded = recorded.lock().unwrap();
        assert_eq!(recorded.mutations.len(), 1);
        assert_eq!(recorded.reads.len(), 1);
    }
}

#[test]
fn test_unverified_mutation_response_cannot_be_reported_as_a_completed_action() {
    for response in [json!("ready"), json!({}), json!({"status": "unexpected"})] {
        let (mut session, recorded) = session(vec![json!("ready"), response]);
        let error = execute(&mut session, "like").unwrap_err();
        assert!(error.is(SessionKind::EngagementUncertain), "{error:?}");
        assert_eq!(recorded.lock().unwrap().mutations.len(), 1);
    }
}

#[test]
fn test_unavailable_post_click_confirmation_requires_inspection() {
    for response in [
        json!("unsupported"),
        json!({"status": "failed", "reason": "wrong_account"}),
        json!({"status": "invalid"}),
    ] {
        let (mut session, recorded) = session(vec![json!("ready"), json!("clicked"), response]);
        let error = execute(&mut session, "like").unwrap_err();
        assert!(error.is(SessionKind::EngagementUncertain), "{error:?}");
        assert!(error.to_string().contains("completion is uncertain"));
        assert_eq!(recorded.lock().unwrap().mutations.len(), 1);
    }
}

#[test]
fn test_known_failed_pre_click_recheck_is_not_action_uncertainty() {
    let (mut session, recorded) = session(vec![
        json!("ready"),
        json!({"status": "failed", "reason": "wrong_account"}),
    ]);
    let error = execute(&mut session, "like").unwrap_err();
    assert!(error.is_session());
    assert!(error.to_string().contains("intended account"));
    assert!(!error.is(SessionKind::EngagementUncertain));
    assert_eq!(recorded.lock().unwrap().mutations.len(), 1);
}

#[test]
fn test_action_confirmation_retries_bridge_reads_without_repeating_click() {
    let mut reads = 0;
    let runner = ScriptedRunner::new(move |source| {
        reads += 1;
        assert!(source.contains("if (!false)"));
        if reads == 1 {
            return Err(BrowserError::transient("Apple Event -1719"));
        }
        Ok(json!({"status": "already_done"}).to_string())
    });
    let sources = runner.sources.clone();
    let host = FakeHost::idle();
    let mut session = BrowserInstagramSession::new(bridge(&host), Box::new(runner), true, None);
    let result = complete(
        &mut session,
        RECIPIENT,
        ACCOUNT,
        URL,
        "like",
        json!({"action": "like", "status": "clicked"}),
    )
    .unwrap();
    assert_eq!(result, json!({"action": "like", "status": "succeeded"}));
    assert_eq!(sources.lock().unwrap().len(), 2);
}

#[test]
fn test_unsupported_repost_is_reported_without_claiming_success() {
    let (mut session, recorded) = session(statuses(&["unsupported"]));
    let result = execute(&mut session, "repost").unwrap();
    assert_eq!(result["status"], json!("unsupported"));
    assert!(result["reason"].as_str().unwrap().contains("no explicit"));
    assert!(recorded.lock().unwrap().mutations.is_empty());
}

#[test]
fn test_invalid_url_and_action_fail_before_touching_browser() {
    let (mut session, recorded) = session(Vec::new());
    for (url, action) in [
        ("https://attacker.test", "like"),
        ("https://instagram.com/p/A/", "delete"),
    ] {
        let error = if action == "delete" {
            action_state(&mut session, RECIPIENT, ACCOUNT, url, action, true).unwrap_err()
        } else {
            engage_post(&mut session, RECIPIENT, ACCOUNT, url, false).unwrap_err()
        };
        assert!(error.is_session(), "{error:?}");
    }
    let recorded = recorded.lock().unwrap();
    assert_eq!(recorded.activations, 0);
    assert!(recorded.navigations.is_empty());
    assert!(recorded.reads.is_empty() && recorded.mutations.is_empty());
}

const OWN_NAV: &str =
    "<nav><a href='/usask.wat2do.io/'><img alt=\"usask.wat2do.io's profile picture\"></a></nav>";

#[test]
fn test_standalone_post_uses_author_prefixed_timestamp_without_article() {
    let html = format!(
        "{OWN_NAV}<main><div><section>{}</section>\
         <a href='/club/p/TARGET123/'>timestamp</a></div>\
         <div><a href='/club/p/RECOMMENDED/'>suggested post</a></div></main>",
        toolbar()
    );
    for action in ["like", "save"] {
        assert_evaluates(
            evaluate(&html, action, false),
            json!({"state": {"status": "ready"}, "clicks": []}),
        );
    }
}

#[test]
fn test_standalone_main_can_own_its_direct_toolbar_and_timestamp() {
    for tag in ["main", r#"div role="main""#] {
        let closing = tag.split(' ').next().unwrap();
        let html = format!(
            "{OWN_NAV}<{tag}><section>{}</section>\
             <a href='/club/p/TARGET123/'>timestamp</a></{closing}>",
            toolbar()
        );
        assert_evaluates(
            evaluate(&html, "like", true),
            json!({"state": {"status": "clicked"}, "clicks": ["post-like"]}),
        );
    }
}

#[test]
fn test_hidden_sibling_post_does_not_block_a_directly_owned_standalone_toolbar() {
    let html = format!(
        "{OWN_NAV}<main><section>{}</section>\
         <a href='/club/p/TARGET123/'>timestamp</a>\
         <article aria-hidden='true'><a href='/p/OTHER/'>hidden other post</a></article></main>",
        toolbar()
    );
    assert_evaluates(
        evaluate(&html, "like", true),
        json!({"state": {"status": "clicked"}, "clicks": ["post-like"]}),
    );
}

#[test]
fn test_toolbar_cannot_borrow_target_permalink_from_a_separate_post_subtree() {
    for wrapper in [false, true] {
        for tag in ["main", r#"div role="main""#] {
            let closing = tag.split(' ').next().unwrap();
            let other_toolbar = toolbar().replace(r#"id="post-like""#, r#"id="wrong-post-like""#);
            let siblings = format!(
                "<div><section>{other_toolbar}</section></div>\
                 <article><a href='/p/TARGET123/'>other subtree timestamp</a></article>"
            );
            let inner = if wrapper {
                format!("<div>{siblings}</div>")
            } else {
                siblings
            };
            let html = format!("{OWN_NAV}<{tag}>{inner}</{closing}>");
            assert_evaluates(
                evaluate(&html, "like", true),
                json!({"state": {"status": "failed", "reason": "ambiguous_post"}, "clicks": []}),
            );
        }
    }
}

#[test]
fn test_other_post_toolbar_is_excluded_by_its_own_permalink() {
    let extra_post = format!(
        "<article><section>{}</section>\
         <a href='/club/p/OTHER/'>other post timestamp</a></article>",
        toolbar()
    );
    let result = evaluate(
        &fixture_with(&toolbar(), &extra_post, false, ACCOUNT),
        "like",
        true,
    );
    if let Some(clicks) = clicks(&result) {
        assert_eq!(clicks, &json!(["post-like"]));
    }
}

#[test]
fn test_toolbar_without_target_permalink_is_not_guessed() {
    let html = fixture(&toolbar()).replace("/p/TARGET123/", "/p/OTHER/");
    assert_evaluates(
        evaluate(&html, "like", true),
        json!({"state": {"status": "failed", "reason": "ambiguous_post"}, "clicks": []}),
    );
}

// Captured from the live post toolbar before and after the approved repost.
const OBSERVED_REPOST_INACTIVE: &str = "M19.998 9.497a1 1 0 0 0-1 1v4.228a3.274 3.274 0 0 1-3.27 3.27h-5.313l1.791-1.787a1 1 0 0 0-1.412-1.416L7.29 18.287a1.004 1.004 0 0 0-.294.707v.001c0 .023.012.042.013.065a.923.923 0 0 0 .281.643l3.502 3.504a1 1 0 0 0 1.414-1.414l-1.797-1.798h5.318a5.276 5.276 0 0 0 5.27-5.27v-4.228a1 1 0 0 0-1-1Zm-6.41-3.496-1.795 1.795a1 1 0 1 0 1.414 1.414l3.5-3.5a1.003 1.003 0 0 0 0-1.417l-3.5-3.5a1 1 0 0 0-1.414 1.414l1.794 1.794H8.27A5.277 5.277 0 0 0 3 9.271V13.5a1 1 0 0 0 2 0V9.271a3.275 3.275 0 0 1 3.271-3.27Z";
const OBSERVED_REPOST_ACTIVE: &str = "M16 6.001a1 1 0 0 0 .924-1.382.998.998 0 0 0-.217-.326l-3.5-3.5a1 1 0 1 0-1.414 1.414l1.794 1.794H8.27A5.277 5.277 0 0 0 3 9.271V13.5a1 1 0 1 0 2 0V9.271a3.275 3.275 0 0 1 3.271-3.27h7.73Zm3.998 3.496a1 1 0 0 0-1 1v4.228a3.274 3.274 0 0 1-3.27 3.27H7.996a1.001 1.001 0 0 0-.706 1.708l3.502 3.504a.997.997 0 0 0 1.414 0 1 1 0 0 0 0-1.414l-1.797-1.798h5.317a5.276 5.276 0 0 0 5.271-5.27v-4.228a1 1 0 0 0-1-1Zm-5.205-.51-3.905 3.906-1.681-1.681a1 1 0 1 0-1.414 1.414l2.388 2.388a1 1 0 0 0 1.414 0l4.612-4.614a1 1 0 1 0-1.414-1.414Z";

fn with_glyph(toolbar: &str, glyph: &str) -> String {
    toolbar.replace(
        "<title>Repost</title>",
        &format!(r#"<title>Repost</title><path d="{glyph}"></path>"#),
    )
}

#[test]
fn test_live_native_repost_glyphs_without_pressed_state() {
    for (glyph, status, clicks) in [
        (OBSERVED_REPOST_INACTIVE, "clicked", json!(["repost"])),
        (OBSERVED_REPOST_ACTIVE, "already_done", json!([])),
        ("unknown-future-glyph", "unsupported", json!([])),
    ] {
        assert_evaluates(
            evaluate(&fixture(&with_glyph(&toolbar(), glyph)), "repost", true),
            json!({"state": {"status": status}, "clicks": clicks}),
        );
    }
}

#[test]
fn test_conflicting_repost_pressed_and_observed_glyph_states_never_click() {
    for click in [false, true] {
        for (pressed, glyph) in [
            ("false", OBSERVED_REPOST_ACTIVE),
            ("true", OBSERVED_REPOST_INACTIVE),
        ] {
            assert_evaluates(
                evaluate(
                    &fixture(&with_glyph(&pressed_toolbar(pressed), glyph)),
                    "repost",
                    click,
                ),
                json!({"state": {"status": "failed", "reason": "unknown_state"}, "clicks": []}),
            );
        }
    }
}

#[test]
fn test_consistent_native_repost_pressed_and_glyph_states_remain_supported() {
    for (pressed, glyph, status, clicks) in [
        (
            "false",
            OBSERVED_REPOST_INACTIVE,
            "clicked",
            json!(["repost"]),
        ),
        ("true", OBSERVED_REPOST_ACTIVE, "already_done", json!([])),
    ] {
        assert_evaluates(
            evaluate(
                &fixture(&with_glyph(&pressed_toolbar(pressed), glyph)),
                "repost",
                true,
            ),
            json!({"state": {"status": status}, "clicks": clicks}),
        );
    }
}

#[test]
fn test_invalid_explicit_repost_state_cannot_fall_back_to_its_glyph() {
    for pressed in ["mixed", "invalid"] {
        assert_evaluates(
            evaluate(
                &fixture(&with_glyph(
                    &pressed_toolbar(pressed),
                    OBSERVED_REPOST_INACTIVE,
                )),
                "repost",
                true,
            ),
            json!({"state": {"status": "failed", "reason": "unknown_state"}, "clicks": []}),
        );
    }
}

#[test]
fn test_active_repost_badge_outside_toolbar_cannot_mark_post_reposted() {
    let toolbar = with_glyph(&toolbar(), OBSERVED_REPOST_INACTIVE);
    let badge = format!(
        r#"<div><svg aria-label="Repost"><path d="{OBSERVED_REPOST_ACTIVE}"></path></svg></div>"#
    );
    assert_evaluates(
        evaluate(
            &fixture_with(&toolbar, &badge, false, ACCOUNT),
            "repost",
            true,
        ),
        json!({"state": {"status": "clicked"}, "clicks": ["repost"]}),
    );
}

#[test]
fn test_post_job_navigates_once_and_completes_like_then_repost() {
    let (mut session, recorded) = session(statuses(&[
        "ready",
        "clicked",
        "already_done",
        "ready",
        "clicked",
        "already_done",
    ]));
    let result = engage_post(&mut session, RECIPIENT, ACCOUNT, URL, false).unwrap();
    assert_eq!(result["status"], json!("succeeded"));
    let actions = result["actions"].as_object().unwrap();
    assert_eq!(actions.keys().collect::<Vec<_>>(), ["like", "repost"]);
    assert!(
        actions
            .values()
            .all(|action| action["status"] == json!("succeeded"))
    );
    assert_prepared_once(&recorded.lock().unwrap());
}

#[test]
fn test_post_waits_for_each_disabled_control_before_its_single_click() {
    let (mut session, recorded) = session(vec![
        json!({"status": "not_ready"}),
        json!("ready"),
        json!("clicked"),
        json!("already_done"),
        json!({"status": "not_ready"}),
        json!("ready"),
        json!("clicked"),
        json!("already_done"),
    ]);
    let result = engage_post(&mut session, RECIPIENT, ACCOUNT, URL, false).unwrap();
    assert_eq!(result["status"], json!("succeeded"));
    let recorded = recorded.lock().unwrap();
    assert_eq!(recorded.mutations.len(), 2);
    assert_eq!(recorded.reads.len(), 6);
    assert_prepared_once(&recorded);
}

#[test]
fn test_permanently_disabled_action_times_out_without_a_click() {
    let (mut session, recorded) = session(statuses(&["not_ready", "not_ready", "not_ready"]));
    let error = execute(&mut session, "like").unwrap_err();
    assert!(error.is_session());
    assert!(error.to_string().contains("timed out"), "{error}");
    let recorded = recorded.lock().unwrap();
    assert!(recorded.mutations.is_empty());
    assert_eq!(recorded.reads.len(), 3);
}

#[test]
fn test_readiness_preserves_human_blocks_and_identity_failures() {
    for reason in ["blocked", "wrong_account", "wrong_post"] {
        let (mut session, recorded) = session(vec![json!({"status": "failed", "reason": reason})]);
        let error = execute(&mut session, "like").unwrap_err();
        assert!(error.is_session());
        assert_eq!(error.to_string(), failure_message(Some(&json!(reason))));
        let recorded = recorded.lock().unwrap();
        assert!(recorded.mutations.is_empty());
        assert_eq!(recorded.reads.len(), 1);
    }
}

#[test]
fn test_action_disabled_after_readiness_is_not_clicked_or_retried() {
    let (mut session, recorded) = session(statuses(&["ready", "not_ready"]));
    let error = execute(&mut session, "like").unwrap_err();
    assert!(error.is_session());
    assert!(error.to_string().contains("not ready for engagement"));
    let recorded = recorded.lock().unwrap();
    assert_eq!(recorded.mutations.len(), 1);
    assert_eq!(recorded.reads.len(), 1);
}

#[test]
fn test_inspection_waits_for_enabled_actions_without_mutation() {
    let (mut session, recorded) = session(statuses(&["not_ready", "ready", "not_ready", "ready"]));
    let result = engage_post(&mut session, RECIPIENT, ACCOUNT, URL, true).unwrap();
    assert_eq!(result["status"], json!("ready"));
    let recorded = recorded.lock().unwrap();
    assert!(recorded.mutations.is_empty());
    assert_eq!(recorded.reads.len(), 4);
}

#[test]
fn test_post_retry_preserves_completed_like_and_only_finishes_repost() {
    let (mut session, recorded) = session(statuses(&[
        "already_done",
        "ready",
        "clicked",
        "already_done",
    ]));
    let result = engage_post(&mut session, RECIPIENT, ACCOUNT, URL, false).unwrap();
    assert_eq!(result["actions"]["like"]["status"], json!("already_done"));
    assert_eq!(result["actions"]["repost"]["status"], json!("succeeded"));
    assert_prepared_once(&recorded.lock().unwrap());
}
