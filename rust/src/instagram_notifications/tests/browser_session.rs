//! Ported from the Python test suite (`tests/services/instagram_notifications/test_browser_session.py`).
//!
//! Python patched `subprocess.run`, `_run_applescript`, `time.monotonic` and `time.sleep`;
//! here every osascript call goes to a `FakeHost` whose clock only moves on sleep. Python's
//! module globals `_APPLESCRIPT_LOCK`, `_NAVIGATION_LOCK` and `_LAST_NAVIGATION_AT` are
//! fields of the one `Bridge` each test builds. Python tests that replaced
//! `BrowserInstagramSession` inside the pool drive the real sessions through a scripted
//! Brave (`Brave` below) instead.

use std::io::Write;
use std::process::{Command, Stdio};
use std::sync::{Arc, Barrier, Mutex};
use std::thread;
use std::time::Duration;

use serde_json::{Value, json};

use super::super::browser_ingestion;
use super::super::browser_queue::{BrowserJob, BrowserJobQueue};
use super::super::errors::{BrowserError, BrowserResult, SessionKind};
use super::super::scripts;
use super::super::test_support::{FakeHost, FakeMailbox, HostCall, bridge, failed, ok, queue};
use super::bridge::{Bridge, OSASCRIPT, TAB_CLOSED, TAB_LOADING, TIMED_OUT};
use super::runner::{JavascriptRunner, PinnedRunner};
use super::session::{BrowserInstagramSession, LOGGED_OUT_PAUSE};
use super::tab_pool::{BrowserTabPool, TabPool};
use super::{canonical_post_url, school_account_username, validate_account_username};
use crate::controlbox::{InheritedControls, instagram_browser as control, overrides};
use crate::host::{CommandError, CommandOutput, Event, Host};
use crate::pyjson;

// ---------------------------------------------------------------------------------------
// Doubles

type Shared<T> = Arc<Mutex<T>>;

fn shared<T>(value: T) -> Shared<T> {
    Arc::new(Mutex::new(value))
}

/// The autouse fixture: tests unrelated to pacing must not wait on prior fake page loads.
fn setup() {
    overrides::instagram_browser(|control| control.navigation_interval_seconds = 0.0);
}

/// A thread that sees this test's control overrides, as the worker's threads do.
fn spawn<T: Send + 'static>(work: impl FnOnce() -> T + Send + 'static) -> thread::JoinHandle<T> {
    let controls = InheritedControls::capture();
    thread::spawn(move || {
        controls.install();
        work()
    })
}

fn error_of<T>(result: BrowserResult<T>) -> BrowserError {
    match result {
        Ok(_) => panic!("expected an error"),
        Err(error) => error,
    }
}

fn timed_out() -> Result<CommandOutput, CommandError> {
    Err(CommandError::Timeout)
}

type Respond = dyn FnMut(&str, f64) -> BrowserResult<String> + Send;
type Navigate = dyn FnMut(&str, f64, bool) -> BrowserResult<String> + Send;

/// Python's `javascript_runner=` callables, which also saw each call's timeout.
struct FnRunner {
    respond: Box<Respond>,
    navigate: Option<Box<Navigate>>,
}

fn runner(respond: impl FnMut(&str, f64) -> BrowserResult<String> + Send + 'static) -> FnRunner {
    FnRunner {
        respond: Box::new(respond),
        navigate: None,
    }
}

impl FnRunner {
    fn navigating(
        mut self,
        navigate: impl FnMut(&str, f64, bool) -> BrowserResult<String> + Send + 'static,
    ) -> Self {
        self.navigate = Some(Box::new(navigate));
        self
    }
}

impl JavascriptRunner for FnRunner {
    fn run(&mut self, source: &str, timeout: f64) -> BrowserResult<String> {
        (self.respond)(source, timeout)
    }

    fn navigate(&mut self, url: &str, timeout: f64, reload: bool) -> Option<BrowserResult<String>> {
        self.navigate
            .as_mut()
            .map(|navigate| navigate(url, timeout, reload))
    }
}

fn session_with(
    host: &Arc<FakeHost>,
    runner: impl JavascriptRunner + 'static,
    allow_account_switch: bool,
    job_timeout: Option<f64>,
) -> BrowserInstagramSession {
    BrowserInstagramSession::new(
        bridge(host),
        Box::new(runner),
        allow_account_switch,
        job_timeout,
    )
}

fn session(
    host: &Arc<FakeHost>,
    runner: impl JavascriptRunner + 'static,
) -> BrowserInstagramSession {
    session_with(host, runner, true, None)
}

/// `_PinnedBraveJavascriptRunner(tab_id, window_id=window_id)`.
fn pinned(bridge: &Arc<Bridge>, tab_id: &str, window_id: &str) -> PinnedRunner {
    let mut runner = PinnedRunner::tab(bridge, tab_id);
    runner.window_id = Some(window_id.to_owned());
    runner
}

fn tab_of(session: &mut BrowserInstagramSession) -> String {
    session
        .pinned_runner()
        .and_then(|runner| runner.tab_id.clone())
        .expect("a pinned session")
}

/// A host that also runs `on_sleep` before each (virtual) sleep, as tests that patched
/// `time.sleep` to wait on other threads did.
struct HookedHost {
    inner: Arc<FakeHost>,
    on_sleep: Box<dyn Fn(f64) + Send + Sync>,
}

impl Host for HookedHost {
    fn run(
        &self,
        program: &str,
        args: &[String],
        stdin: Option<&str>,
        timeout: f64,
    ) -> Result<CommandOutput, CommandError> {
        self.inner.run(program, args, stdin, timeout)
    }

    fn monotonic(&self) -> f64 {
        self.inner.monotonic()
    }

    fn time(&self) -> f64 {
        self.inner.time()
    }

    fn sleep(&self, seconds: f64) {
        (self.on_sleep)(seconds);
        self.inner.sleep(seconds);
    }
}

fn hooked_bridge(
    host: &Arc<FakeHost>,
    on_sleep: impl Fn(f64) + Send + Sync + 'static,
) -> Arc<Bridge> {
    Bridge::new(
        Arc::new(HookedHost {
            inner: host.clone(),
            on_sleep: Box::new(on_sleep),
        }),
        Arc::new(FakeMailbox::default()),
    )
}

fn arguments(call: &HostCall) -> Vec<String> {
    call.script_arguments().to_vec()
}

fn strings(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| (*value).to_owned()).collect()
}

const SECURITY: &str = "/usr/bin/security";
const IOREG: &str = "/usr/sbin/ioreg";

/// Brave windows as `[(window_id, [(tab_id, url)])]`; a worker popup holds one tab.
/// Every page source a tab runs (other than the viewport probe) goes to the test's page.
#[derive(Default)]
struct Brave {
    windows: Vec<(String, Vec<(String, String)>)>,
    next_id: u64,
    opened: Vec<String>,
    closed: Vec<String>,
    /// `(tab_id, url, reload)` native navigations.
    navigations: Vec<(String, String, bool)>,
    /// `(tab_id, source)` page sources, in order.
    sources: Vec<(String, String)>,
    /// Scripts that carried a secret on stdin.
    secrets: Vec<String>,
    /// Keychain passwords by account; `None` when none is stored.
    passwords: Vec<(String, String)>,
    keychain_asked: Vec<String>,
}

impl Brave {
    fn new(windows: Vec<(String, Vec<(String, String)>)>) -> Self {
        Self {
            windows,
            next_id: 1000,
            ..Self::default()
        }
    }

    fn find(&self, tab_id: &str) -> Option<(String, String)> {
        self.windows.iter().find_map(|(window, tabs)| {
            tabs.iter()
                .find(|(tab, _)| tab == tab_id)
                .map(|(_, url)| (window.clone(), url.clone()))
        })
    }

    fn set_url(&mut self, tab_id: &str, url: &str) {
        for (_, tabs) in &mut self.windows {
            for tab in tabs.iter_mut() {
                if tab.0 == tab_id {
                    tab.1 = url.to_owned();
                }
            }
        }
    }

    fn path(&self, tab_id: &str) -> String {
        let (_, url) = self.find(tab_id).expect("tab exists");
        url.split_once("instagram.com")
            .map(|(_, path)| path.to_owned())
            .expect("an Instagram page")
    }

    fn remove_window(&mut self, window_id: &str) {
        self.windows.retain(|(window, _)| window != window_id);
    }
}

fn one_tab_windows(tabs: &[(&str, &str, &str)]) -> Vec<(String, Vec<(String, String)>)> {
    tabs.iter()
        .map(|(window, tab, url)| {
            (
                (*window).to_owned(),
                vec![((*tab).to_owned(), (*url).to_owned())],
            )
        })
        .collect()
}

type Page = dyn FnMut(&mut Brave, &str, &str) -> Result<CommandOutput, CommandError> + Send;

fn brave_host(
    brave: Shared<Brave>,
    page: impl FnMut(&mut Brave, &str, &str) -> Result<CommandOutput, CommandError> + Send + 'static,
) -> Arc<FakeHost> {
    let mut page: Box<Page> = Box::new(page);
    FakeHost::new(move |call| {
        let mut brave = brave.lock().unwrap();
        if call.program == IOREG {
            return ok("\"HIDIdleTime\" = 99000000000\n");
        }
        if call.program == SECURITY {
            let account = call.args[call.args.iter().position(|a| a == "-a").unwrap() + 1].clone();
            brave.keychain_asked.push(account.clone());
            return match brave.passwords.iter().find(|(name, _)| *name == account) {
                Some((_, password)) => ok(&format!("{password}\n")),
                None => Ok(CommandOutput {
                    code: 44,
                    stdout: String::new(),
                    stderr: String::new(),
                }),
            };
        }
        let script = call.script().expect("osascript").to_owned();
        let args = arguments(call);
        if call.stdin.is_some() {
            brave.secrets.push(script.clone());
            return ok("submitted\n");
        }
        if script == scripts::FRONT_APPLICATION {
            return ok("700\n");
        }
        if script == scripts::LIVE_WORKER_TABS {
            let live: Vec<String> = args
                .iter()
                .filter(|tab| {
                    brave
                        .find(tab)
                        .is_some_and(|(_, url)| url.starts_with("https://www.instagram.com/"))
                })
                .cloned()
                .collect();
            return ok(&live.join("\n"));
        }
        if script == scripts::OPEN_WORKER_WINDOW {
            let (opener, source) = (&args[0], &args[1]);
            assert!(source.contains("'popup,noopener,"));
            brave.opened.push(opener.clone());
            let start = source.find("window.open(").unwrap() + "window.open(".len();
            let end = source.find(", '_blank'").unwrap();
            let url: String = serde_json::from_str(&source[start..end]).unwrap();
            brave.next_id += 2;
            let window = brave.next_id.to_string();
            let tab = (brave.next_id + 1).to_string();
            brave.windows.push((window, vec![(tab.clone(), url)]));
            return ok(&format!("{tab}\n"));
        }
        if script == scripts::WORKER_WINDOW {
            return match brave.find(&args[0]) {
                Some((window, _)) => ok(&format!("{window}\n")),
                None => failed("execution error: Pinned Instagram tab is closed. (-2700)"),
            };
        }
        if script == scripts::EXECUTE_TAB {
            let (tab, source, window) = (&args[0], &args[1], &args[2]);
            match brave.find(tab) {
                Some((found, _)) if found == *window => {}
                _ => return failed("execution error: Pinned Instagram tab is closed. (-2700)"),
            }
            if source == scripts::VIEWPORT {
                return ok("{\"width\":1300,\"height\":900}\n");
            }
            brave.sources.push((tab.clone(), source.clone()));
            return page(&mut brave, tab, source);
        }
        if script == scripts::NAVIGATE_TAB {
            let (tab, url) = (&args[0], &args[1]);
            brave.set_url(tab, url);
            brave
                .navigations
                .push((tab.clone(), url.clone(), args[3] == "true"));
            return ok("navigating\n");
        }
        if script == scripts::CLOSE_WORKER_TAB {
            let (tab, window) = (args[0].clone(), args[1].clone());
            for (id, tabs) in &mut brave.windows {
                if *id == window {
                    tabs.retain(|(id, _)| *id != tab);
                }
            }
            brave.windows.retain(|(_, tabs)| !tabs.is_empty());
            brave.closed.push(tab);
            return ok("closed\n");
        }
        if script == scripts::ACTIVATE_TAB {
            return ok("1\n");
        }
        if script == scripts::RESTORE_ACTIVE_TAB {
            return ok("restored\n");
        }
        panic!("unexpected script: {script}");
    })
}

/// A logged-in page in every tab showing `username`.
fn logged_in_page(
    username: impl Fn(&Brave) -> String + Send + 'static,
) -> impl FnMut(&mut Brave, &str, &str) -> Result<CommandOutput, CommandError> + Send + 'static {
    move |brave, tab, source| {
        if source == scripts::CANCEL_REQUEST {
            return ok("settled");
        }
        if source == scripts::CLEAR_REQUEST {
            return ok("cleared");
        }
        if source == scripts::CURRENT_PATH {
            return ok(&brave.path(tab));
        }
        if source == scripts::PAGE_RESPONSE {
            return ok(&json!({"path": brave.path(tab), "rate_limited": false}).to_string());
        }
        if source == scripts::CURRENT_ACCOUNT_USERNAME {
            return ok(&username(brave));
        }
        if source == scripts::SERVER_LOGIN {
            return ok("logged_in");
        }
        if source == scripts::LOGGED_OUT {
            return ok("false");
        }
        if source == scripts::ACCOUNT_CHOOSER_STATE {
            return ok("pending");
        }
        if source.contains("activeRecipient") {
            return ok("true");
        }
        panic!("unexpected page source: {source}");
    }
}

fn job(kind: &str, recipient_id: &str, account_username: &str) -> BrowserJob {
    BrowserJob {
        id: "job".to_owned(),
        kind: kind.to_owned(),
        school: "ubc".to_owned(),
        recipient_id: recipient_id.to_owned(),
        account_username: account_username.to_owned(),
        payload: serde_json::Map::new(),
        state: "running".to_owned(),
        created_at: 0.0,
        started_at: None,
        result: None,
        error: None,
        attempts: 0,
    }
}

/// `node`, fed `input` on stdin; `None` (the test skips) when Node.js is unavailable.
fn node(arguments: &[&str], input: &str) -> Option<(bool, String, String)> {
    let mut child = match Command::new("node")
        .args(arguments)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return None,
        other => other.expect("node starts"),
    };
    child
        .stdin
        .take()
        .unwrap()
        .write_all(input.as_bytes())
        .unwrap();
    let output = child.wait_with_output().unwrap();
    Some((
        output.status.success(),
        String::from_utf8_lossy(&output.stdout).into_owned(),
        String::from_utf8_lossy(&output.stderr).into_owned(),
    ))
}

fn node_json(script: &str) -> Option<Value> {
    let (success, stdout, stderr) = node(&[], script)?;
    assert!(success, "{stderr}");
    Some(serde_json::from_str(&stdout).expect("node printed JSON"))
}

/// `_FixtureParser`: a small HTML tree as JSON; `retain_text` keeps each element's own text
/// in `data-fixture-text`, as the account identity tests did.
fn parse_fixture(html: &str, retain_text: bool) -> Value {
    const VOID: [&str; 6] = ["img", "input", "br", "hr", "meta", "link"];
    let mut stack: Vec<Value> = vec![json!({"tag": "document", "attrs": {}, "children": []})];
    let mut rest = html;
    while !rest.is_empty() {
        if let Some(after) = rest.strip_prefix("</") {
            let end = after.find('>').unwrap();
            let tag = after[..end].trim().to_lowercase();
            let node = stack.pop().unwrap();
            assert_eq!(node["tag"], json!(tag));
            stack.last_mut().unwrap()["children"]
                .as_array_mut()
                .unwrap()
                .push(node);
            rest = &after[end + 1..];
        } else if let Some(after) = rest.strip_prefix('<') {
            let name_end = after
                .find(|c: char| c.is_whitespace() || c == '>' || c == '/')
                .unwrap();
            let tag = after[..name_end].to_lowercase();
            let mut attrs = serde_json::Map::new();
            let mut cursor = &after[name_end..];
            loop {
                cursor = cursor.trim_start();
                if let Some(next) = cursor.strip_prefix('>') {
                    cursor = next;
                    break;
                }
                if let Some(next) = cursor.strip_prefix("/>") {
                    cursor = next;
                    break;
                }
                let name_end = cursor
                    .find(|c: char| c.is_whitespace() || c == '=' || c == '>' || c == '/')
                    .unwrap();
                let name = cursor[..name_end].to_lowercase();
                cursor = cursor[name_end..].trim_start();
                if let Some(next) = cursor.strip_prefix('=') {
                    let next = next.trim_start();
                    let quote = next.chars().next().unwrap();
                    let (value, remaining) = if quote == '"' || quote == '\'' {
                        let close = next[1..].find(quote).unwrap() + 1;
                        (&next[1..close], &next[close + 1..])
                    } else {
                        let close = next.find(|c: char| c.is_whitespace() || c == '>').unwrap();
                        (&next[..close], &next[close..])
                    };
                    attrs.insert(name, json!(value));
                    cursor = remaining;
                } else {
                    attrs.insert(name, Value::Null);
                }
            }
            let node = json!({"tag": tag, "attrs": attrs, "children": []});
            if VOID.contains(&tag.as_str()) {
                stack.last_mut().unwrap()["children"]
                    .as_array_mut()
                    .unwrap()
                    .push(node);
            } else {
                stack.push(node);
            }
            rest = cursor;
        } else {
            let end = rest.find('<').unwrap_or(rest.len());
            if retain_text {
                let top = stack.last_mut().unwrap();
                let previous = top["attrs"]["data-fixture-text"]
                    .as_str()
                    .unwrap_or_default()
                    .to_owned();
                top["attrs"]["data-fixture-text"] = json!(previous + &rest[..end]);
            }
            rest = &rest[end..];
        }
    }
    assert_eq!(stack.len(), 1, "unclosed fixture tags");
    stack.pop().unwrap()
}

/// `_DOM_ADAPTER` from the engagement tests.
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

/// `DOM_ADAPTER` over an HTML fixture as `document`, each element keeping its text.
fn fixture_document(html: &str) -> String {
    format!(
        r#"{DOM_ADAPTER}
      Object.defineProperty(Element.prototype, "textContent", {{get() {{
        return (this.attrs["data-fixture-text"] || "") +
          this.children.map(child => child.textContent).join("");
      }}}});
      global.document = new Element({root});
    "#,
        root = parse_fixture(html, true)
    )
}

/// What a page source returns over an HTML fixture, and the ids of what it clicked.
fn evaluate_on_page(html: &str, source: &str) -> Option<Value> {
    node_json(&format!(
        "{document}\nconst status = {source};\nconsole.log(JSON.stringify({{status, clicks}}));",
        document = fixture_document(html)
    ))
}

/// `_evaluate_account_identity`: the current-account source over an HTML fixture.
fn evaluate_account_identity(html: &str, ready_state: &str) -> Option<Value> {
    let script = format!(
        r#"{document}
      const bounds = Element.prototype.getBoundingClientRect;
      Element.prototype.getBoundingClientRect = function() {{
        return {{...bounds.call(this), left: Number(this.attrs["data-left"] || 10)}};
      }};
      document.readyState = {ready};
      console.log(JSON.stringify({source}));
    "#,
        document = fixture_document(html),
        ready = pyjson::string(ready_state),
        source = scripts::CURRENT_ACCOUNT_USERNAME,
    );
    node_json(&script)
}

fn identity(html: &str) -> Option<Value> {
    evaluate_account_identity(html, "complete")
}

// ---------------------------------------------------------------------------------------
// Page sources

#[test]
fn test_account_switch_control_sources_parse() {
    setup();
    for source in [
        scripts::OPEN_MORE.to_owned(),
        scripts::SWITCH_BUTTON_STATE.to_owned(),
        scripts::CLICK_SWITCH_ACCOUNTS.to_owned(),
        scripts::ACCOUNT_CHOOSER_STATE.to_owned(),
        scripts::CLOSE_ACCOUNT_CHOOSER.to_owned(),
        scripts::click_account("usask.wat2do.io"),
    ] {
        let Some((success, _, stderr)) = node(&["--check"], &source) else {
            return;
        };
        assert!(success, "{stderr}");
    }
}

#[test]
fn test_viewed_profile_avatar_is_unreadable_until_own_navigation_profile_loads() {
    setup();
    for content_tag in ["main", "article", "section", "div"] {
        let html = format!(
            "<{content_tag}><a href='/dalmackerel/'><img alt=\"dalmackerel's profile picture\"></a></{content_tag}>"
        );
        let Some(result) = identity(&html) else {
            return;
        };
        assert_eq!(result, json!(""));
    }
}

#[test]
fn test_logged_account_navigation_ignores_viewed_profile_owner_in_same_left_column() {
    setup();
    let html = "<nav><a href='/wat2do.uwaterloo/'>\
        <img alt=\"wat2do.uwaterloo's profile picture\"></a></nav>\
        <main><a href='/dalmackerel/'>\
        <img alt=\"dalmackerel's profile picture\"></a></main>";
    if let Some(result) = identity(html) {
        assert_eq!(result, json!("wat2do.uwaterloo"));
    }
}

#[test]
fn test_account_identity_requires_visible_owned_navigation_and_matching_avatar() {
    setup();
    let cases = [
        (
            "<div role='navigation'><a href='/wat2do.uwaterloo/'>\
             <img alt=\"wat2do.uwaterloo's profile picture\"></a></div>",
            "wat2do.uwaterloo",
        ),
        (
            "<nav><a href='/wat2do.uwaterloo/' data-hidden='true'>\
             <img alt=\"wat2do.uwaterloo's profile picture\"></a></nav>\
             <main><a href='/dalmackerel/'>\
             <img alt=\"dalmackerel's profile picture\"></a></main>",
            "",
        ),
        (
            "<nav><a href='/wat2do.uwaterloo/'>\
             <img alt=\"dalmackerel's profile picture\"></a></nav>",
            "",
        ),
        (
            "<nav><a href='/wat2do.uwaterloo/'>\
             <img alt=\"wat2do.uwaterloo's profile picture\"></a>\
             <a href='/wat2do.uwo/'>\
             <img alt=\"wat2do.uwo's profile picture\"></a></nav>",
            "!ambiguous",
        ),
        (
            "<main><nav><a href='/dalmackerel/'>\
             <img alt=\"dalmackerel's profile picture\"></a></nav></main>",
            "",
        ),
        (
            "<div role='dialog'><nav><a href='/dalmackerel/'>\
             <img alt=\"dalmackerel's profile picture\"></a></nav></div>",
            "",
        ),
    ];
    for (html, expected) in cases {
        let Some(result) = identity(html) else {
            return;
        };
        assert_eq!(result, json!(expected), "{html}");
    }
}

#[test]
fn test_logged_identity_uses_explicit_profile_control_when_navigation_has_no_landmark() {
    setup();
    for control in [
        "<a href='/wat2do.uwaterloo/' role='link'>\
         <img alt=\"wat2do.uwaterloo's profile picture\"><span>Profile</span></a>",
        "<a href='/wat2do.uwaterloo/' aria-label='Profile'>\
         <img alt=\"wat2do.uwaterloo's profile picture\"></a>",
        "<a href='/wat2do.uwaterloo/'>\
         <img alt=\"wat2do.uwaterloo's profile picture\">\
         <svg aria-label='Profile'><title>Profile</title></svg></a>",
    ] {
        let html = format!(
            "<div>{control}</div><main><a href='/dalmackerel/'>\
             <img alt=\"dalmackerel's profile picture\"></a></main>"
        );
        let Some(result) = identity(&html) else {
            return;
        };
        assert_eq!(result, json!("wat2do.uwaterloo"));
        assert_eq!(
            evaluate_account_identity(&html, "loading").unwrap(),
            json!("")
        );
    }
}

#[test]
fn test_same_account_in_desktop_and_mobile_navigation_is_deduplicated() {
    setup();
    let link = "<a href='/wat2do.uwaterloo/'><img alt=\"wat2do.uwaterloo's profile picture\"></a>";
    let html = format!("<nav>{link}</nav><div role='navigation'>{link}</div>");
    if let Some(result) = identity(&html) {
        assert_eq!(result, json!("wat2do.uwaterloo"));
    }
}

const ROUTES: [&str; 4] = ["/", "/explore/", "/reels/", "/direct/inbox/"];

fn compact_navigation_fixture(include_profile: bool, routes: &[&str]) -> String {
    let mut controls: String = routes
        .iter()
        .map(|route| format!("<div><a href='{route}' role='link'></a></div>"))
        .collect();
    if include_profile {
        // Live compact layout: unlabelled own avatar has DIV/SPAN/DIV/DIV
        // ancestors before the shared route container at depth five.
        controls += "<div><div><span><div><a href='/wat2do.uwaterloo/' role='link' data-left='608.25'>\
             <img alt=\"wat2do.uwaterloo's profile picture\"></a></div></span></div></div>";
    }
    format!("<div>{controls}</div>")
}

#[test]
fn test_compact_unlabelled_profile_uses_bounded_actual_navigation_routes() {
    setup();
    if let Some(result) = identity(&compact_navigation_fixture(true, &ROUTES)) {
        assert_eq!(result, json!("wat2do.uwaterloo"));
    }
}

#[test]
fn test_public_owner_in_loose_sibling_branch_cannot_borrow_page_navigation() {
    setup();
    for include_profile in [false, true] {
        let html = format!(
            "<div>{}<div><div><a href='/dalmackerel/'>\
             <img alt=\"dalmackerel's profile picture\"></a></div></div></div>",
            compact_navigation_fixture(include_profile, &ROUTES)
        );
        let Some(result) = identity(&html) else {
            return;
        };
        assert_eq!(
            result,
            json!(if include_profile {
                "wat2do.uwaterloo"
            } else {
                ""
            })
        );
    }
}

#[test]
fn test_incomplete_compact_navigation_is_unreadable_during_hydration() {
    setup();
    for missing_route in ROUTES {
        let routes: Vec<&str> = ROUTES
            .iter()
            .copied()
            .filter(|route| *route != missing_route)
            .collect();
        let Some(result) = identity(&compact_navigation_fixture(true, &routes)) else {
            return;
        };
        assert_eq!(result, json!(""), "{missing_route}");
    }
}

#[test]
fn test_unrelated_page_home_link_does_not_complete_partial_navigation() {
    setup();
    let html = format!(
        "<div><a href='/'>page logo</a>{}</div>",
        compact_navigation_fixture(true, &["/explore/", "/reels/", "/direct/inbox/"])
    );
    if let Some(result) = identity(&html) {
        assert_eq!(result, json!(""));
    }
}

// ---------------------------------------------------------------------------------------
// Account switching

/// `AccountBrowser`: a page whose switcher can select `usask.wat2do.io`.
struct Account {
    username: String,
    recipient: bool,
    menu: bool,
    chooser: bool,
    sources: Vec<String>,
}

type Extra = Box<dyn FnMut(&mut Account, &str) -> Option<BrowserResult<String>> + Send>;

fn account_respond(account: &mut Account, source: &str) -> BrowserResult<String> {
    if source == scripts::PAGE_RESPONSE {
        return Ok(
            json!({"path": format!("/{}/", account.username), "rate_limited": false}).to_string(),
        );
    }
    if source == scripts::CANCEL_REQUEST {
        return Ok("settled".to_owned());
    }
    if source == scripts::CLEAR_REQUEST {
        return Ok("cleared".to_owned());
    }
    if source == scripts::CURRENT_ACCOUNT_USERNAME {
        return Ok(account.username.clone());
    }
    if source == scripts::recipient_is_active("41553815702") {
        return Ok(if account.recipient { "true" } else { "false" }.to_owned());
    }
    if source == scripts::OPEN_MORE {
        account.menu = true;
        return Ok("clicked".to_owned());
    }
    if source == scripts::click_account("usask.wat2do.io") {
        account.username = "usask.wat2do.io".to_owned();
        account.recipient = true;
        account.chooser = false;
        return Ok("clicked".to_owned());
    }
    if source == scripts::CLICK_SWITCH_ACCOUNTS {
        account.chooser = true;
        return Ok("clicked".to_owned());
    }
    if source == scripts::ACCOUNT_CHOOSER_STATE {
        return Ok(if account.chooser { "ready" } else { "pending" }.to_owned());
    }
    if source == scripts::SWITCH_BUTTON_STATE {
        return Ok(if account.menu { "ready" } else { "pending" }.to_owned());
    }
    panic!("unexpected source: {source}");
}

fn account_browser(
    username: &str,
    recipient: bool,
    mut extra: Option<Extra>,
) -> (Shared<Account>, FnRunner) {
    let state = shared(Account {
        username: username.to_owned(),
        recipient,
        menu: false,
        chooser: false,
        sources: Vec::new(),
    });
    let inner = state.clone();
    let runner = runner(move |source, _| {
        let mut account = inner.lock().unwrap();
        account.sources.push(source.to_owned());
        if let Some(extra) = extra.as_mut()
            && let Some(result) = extra(&mut account, source)
        {
            return result;
        }
        account_respond(&mut account, source)
    });
    (state, runner)
}

fn count(sources: &[String], source: &str) -> usize {
    sources.iter().filter(|seen| *seen == source).count()
}

#[test]
fn test_switches_once_and_verifies_recipient_without_exporting_credentials() {
    setup();
    let host = FakeHost::idle();
    let (state, fake) = account_browser("ulaval.wat2do.io", false, None);
    let result = session(&host, fake)
        .activate_account("41553815702", "usask.wat2do.io")
        .unwrap();
    assert_eq!(result, "usask.wat2do.io");
    let sources = state.lock().unwrap().sources.clone();
    assert_eq!(
        count(&sources, &scripts::click_account("usask.wat2do.io")),
        1
    );
    assert!(!sources.join("\n").to_lowercase().contains("sessionid"));
}

#[test]
fn test_matching_username_with_wrong_recipient_never_navigates() {
    setup();
    let host = FakeHost::idle();
    let (state, fake) = account_browser("usask.wat2do.io", false, None);
    let error = error_of(session(&host, fake).activate_account("41553815702", "usask.wat2do.io"));
    assert!(error.is_session() && error.to_string().contains("does not match"));
    assert!(
        !state
            .lock()
            .unwrap()
            .sources
            .iter()
            .any(|source| source.contains("location"))
    );
}

#[test]
fn test_accepts_supported_account_names() {
    setup();
    for username in [
        "usask.wat2do.io",
        "wat2do.ca",
        "utm.wat2do.ca",
        "wat2do.usask",
    ] {
        let host = FakeHost::idle();
        let (_, fake) = account_browser(username, true, None);
        assert_eq!(
            session(&host, fake)
                .activate_account("41553815702", username)
                .unwrap(),
            username
        );
    }
}

#[test]
fn test_rejects_noncanonical_navigation_targets() {
    setup();
    for url in [
        "https://attacker.test/p/ABC/",
        "https://instagram.com.evil/p/ABC/",
        "https://www.instagram.com@evil.test/p/ABC/",
        "http://www.instagram.com/p/ABC/",
        "https://www.instagram.com/accounts/login/",
        "https://www.instagram.com/p/a/b/",
        "https://www.instagram.com:443/p/ABC/",
    ] {
        let error = error_of(canonical_post_url(url));
        assert!(error.is_session(), "{url}");
        assert!(error.to_string().contains("post URL is invalid"), "{url}");
    }
}

#[test]
fn test_normalizes_only_valid_post_permalink() {
    setup();
    assert_eq!(
        canonical_post_url("https://instagram.com/p/ABC_12-/?igsh=tracking").unwrap(),
        "https://www.instagram.com/p/ABC_12-/"
    );
}

// ---------------------------------------------------------------------------------------
// Pinned tabs and the AppleScript transport

#[test]
fn test_pins_owned_tab_window_once_and_never_rediscovers_after_navigation() {
    setup();
    let host = FakeHost::new(|call| {
        if call.runs(scripts::WORKER_WINDOW) {
            ok("99")
        } else if call.javascript() == Some(scripts::VIEWPORT) {
            ok("{\"width\":1200,\"height\":900}")
        } else {
            ok("ok")
        }
    });
    let mut runner = PinnedRunner::tab(&bridge(&host), "42");
    assert_eq!(runner.run("first operation", 1.0).unwrap(), "ok");
    assert_eq!(runner.run("second operation", 1.0).unwrap(), "ok");
    let calls = host.calls();
    assert!(calls[0].runs(scripts::WORKER_WINDOW));
    assert_eq!(
        arguments(&calls[1]),
        strings(&["42", scripts::VIEWPORT, "99"])
    );
    assert_eq!(
        arguments(&calls[2]),
        strings(&["42", "first operation", "99"])
    );
    assert_eq!(
        arguments(&calls[3]),
        strings(&["42", "second operation", "99"])
    );
}

#[test]
fn test_runner_never_adopts_a_persons_instagram_tab() {
    setup();
    let host = FakeHost::idle();
    let error = error_of(PinnedRunner::new(bridge(&host), None).run("operation", 1.0));
    assert!(error.is(SessionKind::TabUnavailable));
    assert!(error.to_string().contains("No worker Instagram window"));
    assert!(host.calls().is_empty(), "No tab discovery");
}

#[test]
fn test_browser_errors_are_actionable_and_sanitized() {
    setup();
    for (detail, expected) in [
        (
            "Executing JavaScript through AppleScript is turned off. secret",
            "Enable Brave View",
        ),
        ("Brave is not running. secret", "Open Brave"),
    ] {
        let host = FakeHost::new(move |_| failed(detail));
        let error = error_of(bridge(&host).run_applescript("source", &[], 1.0, false));
        assert!(error.is_session());
        assert!(error.to_string().contains(expected));
        assert!(!error.to_string().contains("secret"));
    }
}

#[test]
fn test_confirmed_pinned_tab_closure_preserves_repairable_failure_type() {
    setup();
    let host = FakeHost::new(|_| failed("Pinned Instagram tab is closed. secret"));
    let error = error_of(bridge(&host).run_applescript("source", &[], 1.0, false));
    assert!(error.is(SessionKind::TabUnavailable));
    assert_eq!(error.to_string(), "The pinned Instagram tab was closed");
}

// ---------------------------------------------------------------------------------------
// Queries and cancellation

#[test]
fn test_query_cancels_and_awaits_settlement_when_interrupted() {
    setup();
    let failures: [fn() -> BrowserError; 3] = [
        || BrowserError::Timeout("interrupted".to_owned()),
        || BrowserError::Interrupted,
        || BrowserError::session("interrupted"),
    ];
    for failure in failures {
        let host = FakeHost::idle();
        let calls = shared(Vec::<String>::new());
        let flags = shared((false, false)); // (started, cancelled)
        let seen = calls.clone();
        let fake = runner(move |source, _| {
            seen.lock().unwrap().push(source.to_owned());
            let mut flags = flags.lock().unwrap();
            if source == "start request" {
                flags.0 = true;
                return Ok("started".to_owned());
            }
            if source == scripts::REQUEST_STATE {
                return Err(failure());
            }
            if source == scripts::CANCEL_REQUEST {
                if flags.0 && !flags.1 {
                    flags.1 = true;
                    return Ok("pending".to_owned());
                }
                return Ok("settled".to_owned());
            }
            if source == scripts::CLEAR_REQUEST {
                return Ok("cleared".to_owned());
            }
            panic!("{source}");
        });
        let error = error_of(session(&host, fake).query("start request", false));
        assert_eq!(error.type_name(), failure().type_name());
        assert_eq!(error.to_string(), failure().to_string());
        let calls = calls.lock().unwrap();
        assert!(
            calls
                .iter()
                .filter(|c| *c == scripts::CANCEL_REQUEST)
                .count()
                >= 3
        );
        assert_eq!(calls.last().unwrap(), scripts::CLEAR_REQUEST);
    }
}

#[test]
fn test_secondary_uncertain_query_cleanup_preserves_result_and_original_error() {
    setup();
    for operation_fails in [false, true] {
        let payload = json!({"state": "failed", "reason": "auth_required"});
        let reply = payload.clone();
        let started = shared(false);
        let host = FakeHost::new(move |call| {
            if call.runs(scripts::WORKER_WINDOW) {
                return ok("99");
            }
            let source = call.javascript().expect("a tab source");
            let mut started = started.lock().unwrap();
            if source == scripts::CANCEL_REQUEST {
                if *started {
                    // A base BrowserSessionError: neither transient nor a closed tab.
                    return failed("unexpected automation failure");
                }
                return ok("settled");
            }
            if source == scripts::CLEAR_REQUEST {
                return ok("cleared");
            }
            if source == "start request" {
                *started = true;
                return ok("started");
            }
            if source == scripts::REQUEST_STATE {
                if operation_fails {
                    // An account change the page reports, as Python's BrowserAccountChanged.
                    return failed("Pinned Instagram tab changed site.");
                }
                return ok(&json!({"result": reply, "settled": false}).to_string());
            }
            panic!("{source}");
        });
        let bridge = bridge(&host);
        let mut tab = pinned(&bridge, "42", "99");
        tab.viewport_ready = true;
        let mut session = BrowserInstagramSession::new(bridge, Box::new(tab), false, None);
        let error = error_of(session.query("start request", true));
        let BrowserError::ReadCleanupPending {
            message,
            operation_error,
            completed_payload,
        } = error
        else {
            panic!("expected a pending read cleanup, got {error:?}");
        };
        assert!(message.contains("cancellation could not be confirmed"));
        let operation_error = operation_error.expect("the original error is kept");
        if operation_fails {
            assert!(operation_error.is(SessionKind::TabUnavailable));
            assert_eq!(completed_payload, None);
        } else {
            // The request never settled within the interaction deadline.
            assert!(operation_error.is(SessionKind::PageUnavailable));
            assert_eq!(completed_payload, Some(payload));
        }
    }
}

#[test]
fn test_atomic_settlement_proof_preserves_terminal_result_under_cleanup_contention() {
    setup();
    for payload in [
        json!({"state": "succeeded", "posts": [{"url": "https://www.instagram.com/p/POST/"}]}),
        json!({"state": "failed", "reason": "auth_required"}),
    ] {
        let host = FakeHost::idle();
        let cancellations = shared(Vec::<bool>::new());
        let seen = cancellations.clone();
        let reply = payload.clone();
        let mut started = false;
        let fake = runner(move |source, _| {
            if source == scripts::CANCEL_REQUEST {
                seen.lock().unwrap().push(started);
                if started {
                    return Err(BrowserError::transient(TIMED_OUT));
                }
                return Ok("settled".to_owned());
            }
            if source == scripts::CLEAR_REQUEST {
                return Ok("cleared".to_owned());
            }
            if source == "start request" {
                started = true;
                return Ok("started".to_owned());
            }
            assert_eq!(source, scripts::REQUEST_STATE);
            Ok(json!({"result": reply, "settled": true}).to_string())
        });
        let result = session(&host, fake).query("start request", true).unwrap();
        assert_eq!(Value::Object(result), payload);
        assert_eq!(*cancellations.lock().unwrap(), vec![false]);
    }
}

#[test]
fn test_query_waits_for_terminal_result_and_settlement_in_one_atomic_read() {
    setup();
    let payload = json!({"state": "succeeded", "media_ids": ["123"]});
    let mut states = vec![
        Value::Null,
        json!({"result": null, "settled": false}),
        json!({"result": {"state": "pending"}, "settled": true}),
        json!({"result": payload, "settled": false}),
        json!({"result": payload, "settled": true}),
    ]
    .into_iter();
    let reads = shared(Vec::<String>::new());
    let seen = reads.clone();
    let host = FakeHost::idle();
    let fake = runner(move |source, _| {
        if source == scripts::CANCEL_REQUEST {
            return Ok("settled".to_owned());
        }
        if source == scripts::CLEAR_REQUEST {
            return Ok("cleared".to_owned());
        }
        if source == "start request" {
            return Ok("started".to_owned());
        }
        seen.lock().unwrap().push(source.to_owned());
        Ok(states.next().unwrap().to_string())
    });
    let result = session(&host, fake).query("start request", true).unwrap();
    assert_eq!(Value::Object(result), payload);
    let reads = reads.lock().unwrap();
    assert_eq!(reads.len(), 5);
    assert_eq!(host.sleeps.lock().unwrap().len(), 4);
    assert!(
        reads
            .iter()
            .all(|source| source.contains("request.result") && source.contains("request.settled"))
    );
}

#[test]
fn test_invalid_atomic_request_state_cannot_skip_cleanup() {
    setup();
    for state in [
        json!([]),
        json!(true),
        json!({"state": "succeeded"}),
        json!({"result": {"state": "succeeded"}, "settled": "true"}),
        json!({"result": {"state": "succeeded"}, "settled": 1}),
        json!({"result": {"state": "succeeded"}, "settled": null}),
        json!({"result": [], "settled": true}),
        json!({"result": {"state": "unknown"}, "settled": true}),
        json!({"result": {}, "settled": true}),
        json!({"result": {"state": "succeeded"}, "settled": true, "extra": true}),
    ] {
        let host = FakeHost::idle();
        let cancellations = shared(Vec::<bool>::new());
        let seen = cancellations.clone();
        let reply = state.to_string();
        let mut started = false;
        let fake = runner(move |source, _| {
            if source == scripts::CANCEL_REQUEST {
                seen.lock().unwrap().push(started);
                return Ok("settled".to_owned());
            }
            if source == scripts::CLEAR_REQUEST {
                return Ok("cleared".to_owned());
            }
            if source == "start request" {
                started = true;
                return Ok("started".to_owned());
            }
            Ok(reply.clone())
        });
        let error = error_of(session(&host, fake).query("start request", false));
        assert!(error.is_session(), "{state}");
        assert!(
            error.to_string().contains("invalid request state"),
            "{state}"
        );
        assert_eq!(*cancellations.lock().unwrap(), vec![false, true], "{state}");
    }
}

#[test]
fn test_terminal_unsettled_result_timing_out_still_aborts_and_cleans_request() {
    setup();
    let host = FakeHost::idle();
    let log = shared((Vec::<bool>::new(), 0usize)); // (cancellations, cleared)
    let seen = log.clone();
    let mut started = false;
    let fake = runner(move |source, _| {
        let mut log = seen.lock().unwrap();
        if source == scripts::CANCEL_REQUEST {
            log.0.push(started);
            return Ok("settled".to_owned());
        }
        if source == scripts::CLEAR_REQUEST {
            log.1 += 1;
            return Ok("cleared".to_owned());
        }
        if source == "start request" {
            started = true;
            return Ok("started".to_owned());
        }
        Ok(json!({"result": {"state": "succeeded"}, "settled": false}).to_string())
    });
    let mut session = session_with(&host, fake, true, Some(1.0));
    let error = error_of(session.query("start request", true));
    assert!(error.is(SessionKind::PageUnavailable));
    assert!(error.to_string().contains("timed out"));
    let log = log.lock().unwrap();
    assert_eq!(log.0, vec![false, true]);
    assert_eq!(log.1, 2);
}

#[test]
fn test_unconfirmed_cancellation_fails_before_switching_account() {
    setup();
    let host = FakeHost::idle();
    let calls = shared(Vec::<String>::new());
    let seen = calls.clone();
    let fake = runner(move |source, _| {
        seen.lock().unwrap().push(source.to_owned());
        Ok("pending".to_owned())
    });
    let error = error_of(session(&host, fake).activate_account("41553815702", "usask.wat2do.io"));
    assert!(error.is_session());
    assert!(
        error
            .to_string()
            .contains("cancellation could not be confirmed")
    );
    assert!(
        calls
            .lock()
            .unwrap()
            .iter()
            .all(|source| source == scripts::CANCEL_REQUEST)
    );
}

#[test]
fn test_shared_account_validator_rejects_unknown_or_overlong_accounts() {
    setup();
    // Python also passed None and 123; Rust's &str parameter cannot hold either.
    let overlong = "x".repeat(25) + ".wat2do.io";
    for value in ["", "other", "school.evil.com", overlong.as_str()] {
        let error = validate_account_username(value).unwrap_err();
        assert!(error.contains("account username is invalid"), "{value}");
    }
}

#[test]
fn test_shared_account_validator_normalizes_supported_accounts() {
    setup();
    assert_eq!(
        validate_account_username("  UBC.WAT2DO.IO ").unwrap(),
        "ubc.wat2do.io"
    );
}

#[test]
fn test_automation_permission_error_preserves_actionable_sanitized_cause() {
    setup();
    for detail in [
        "Not authorized to send Apple events to Brave Browser. secret",
        "An Apple event failed (-1743). secret",
    ] {
        let host = FakeHost::new(move |_| failed(detail));
        let bridge = bridge(&host);
        let tab = pinned(&bridge, "42", "99");
        let error = error_of(
            BrowserInstagramSession::new(bridge, Box::new(tab), true, None)
                .cancel_pending_request(),
        );
        assert!(error.is_session());
        let message = error.to_string();
        assert!(message.contains("Instagram browser request cancellation could not be confirmed"));
        assert!(message.contains("allow it in System Settings > Privacy & Security > Automation"));
        assert!(message.contains("System Settings > Privacy & Security > Automation"));
        assert!(!message.contains("secret"));
    }
}

#[test]
fn test_cancellation_preserves_sanitized_browser_timeout() {
    setup();
    let host = FakeHost::new(|_| timed_out());
    let bridge = bridge(&host);
    let tab = pinned(&bridge, "42", "99");
    let error = error_of(
        BrowserInstagramSession::new(bridge, Box::new(tab), true, None).cancel_pending_request(),
    );
    assert!(error.is_session());
    assert_eq!(
        error.to_string(),
        "Instagram browser request cancellation could not be confirmed: \
         Brave browser automation timed out"
    );
}

#[test]
fn test_cancellation_deadline_does_not_leak_raw_exception_message() {
    setup();
    let host = FakeHost::idle();
    let fake = runner(|_, _| Err(BrowserError::Timeout("secret".to_owned())));
    let error = error_of(session(&host, fake).cancel_pending_request());
    assert!(error.is_session());
    assert_eq!(
        error.to_string(),
        "Instagram browser request cancellation could not be confirmed: \
         the browser job deadline expired"
    );
}

// ---------------------------------------------------------------------------------------
// Navigation

#[test]
fn test_post_navigation_waits_for_delayed_profile_identity_but_rejects_wrong_account() {
    setup();
    for arriving_username in ["usask.wat2do.io", "other.wat2do.io"] {
        let host = FakeHost::idle();
        let state = shared((false, 0usize)); // (navigated, reads after navigation)
        let reader = state.clone();
        let navigator = state.clone();
        let context = format!(
            "({}).status",
            scripts::post_context("https://www.instagram.com/p/POST/")
        );
        let fake = runner(move |source, _| {
            let mut state = reader.lock().unwrap();
            if source == scripts::PAGE_RESPONSE {
                return Ok(json!({"path": "/p/POST/", "rate_limited": false}).to_string());
            }
            if source == context {
                return Ok("ready".to_owned());
            }
            if source == scripts::CURRENT_ACCOUNT_USERNAME {
                if !state.0 {
                    return Ok("usask.wat2do.io".to_owned());
                }
                state.1 += 1;
                return Ok(if state.1 <= 2 { "" } else { arriving_username }.to_owned());
            }
            if source == scripts::recipient_is_active("41553815702") {
                return Ok("true".to_owned());
            }
            panic!("{source}");
        })
        .navigating(move |url, _, _| {
            navigator.lock().unwrap().0 = true;
            assert_eq!(url, "https://www.instagram.com/p/POST/");
            Ok("navigating".to_owned())
        });
        let mut session = session(&host, fake);
        let result = session.navigate_post(
            "https://www.instagram.com/p/POST/",
            "41553815702",
            "usask.wat2do.io",
        );
        if arriving_username == "usask.wat2do.io" {
            assert_eq!(result.unwrap(), "https://www.instagram.com/p/POST/");
        } else {
            let error = error_of(result);
            assert!(error.is_session() && error.to_string().contains("does not match"));
        }
        assert!(state.lock().unwrap().1 >= 3);
    }
}

#[test]
fn test_post_navigation_loads_from_the_page_so_brave_stays_in_the_background() {
    setup();
    for reload in [false, true] {
        let host = FakeHost::new(move |call| {
            assert!(call.runs(scripts::NAVIGATE_TAB));
            // Brave's URL setter raises the app; it only rescues a page too hung to answer.
            let script = call.script().unwrap();
            assert!(script.contains("execute browserTab javascript navigationSource"));
            assert!(script.contains("if errorCode is not -1712"));
            ok(if reload { "navigating" } else { "already_open" })
        });
        let bridge = bridge(&host);
        let tab = pinned(&bridge, "42", "99");
        let mut session = BrowserInstagramSession::new(bridge, Box::new(tab), true, None);
        assert_eq!(
            session
                .navigate("https://www.instagram.com/p/TARGET/", reload)
                .unwrap(),
            if reload { "navigating" } else { "already_open" }
        );
        assert_eq!(
            arguments(&host.calls()[0]),
            strings(&[
                "42",
                "https://www.instagram.com/p/TARGET/",
                "99",
                if reload { "true" } else { "false" },
                "setTimeout(() => window.location.assign(\"https://www.instagram.com/p/TARGET/\"), 0); 1",
            ])
        );
    }
}

/// A host for `_open_window`: idle readings in turn, a focus log, and popups that open as 55.
fn window_host(idle: Vec<f64>, focus: Shared<Vec<String>>) -> Arc<FakeHost> {
    let mut idle = idle.into_iter();
    let mut last_idle = 0.0;
    FakeHost::new(move |call| {
        if call.program == IOREG {
            last_idle = idle.next().unwrap_or(last_idle);
            return ok(&format!("\"HIDIdleTime\" = {}\n", (last_idle * 1e9) as u64));
        }
        if call.runs(scripts::FRONT_APPLICATION) {
            let pid = call.script_arguments().first().cloned().unwrap_or_default();
            let mut focus = focus.lock().unwrap();
            focus.push(pid.clone());
            // Brave took focus.
            return ok(if !pid.is_empty() {
                &pid
            } else if focus.len() == 1 {
                "700"
            } else {
                "31"
            });
        }
        if call.runs(scripts::OPEN_WORKER_WINDOW) {
            return ok("55");
        }
        panic!("unexpected call {call:?}");
    })
}

#[test]
fn test_a_new_worker_window_waits_for_a_pause_and_hands_focus_back() {
    setup();
    let focus = shared(Vec::new());
    let host = window_host(vec![0.5, 1.0, 9.0], focus.clone());
    let start = host.monotonic();
    let directory = tempfile::tempdir().unwrap();
    let pool = BrowserTabPool::new(bridge(&host), queue(directory.path(), &host));
    assert_eq!(
        pool.open_window(Some("1"), "https://www.instagram.com/x/")
            .unwrap(),
        "55"
    );
    assert_eq!(
        host.monotonic() - start,
        2.0 * control().poll_interval_seconds
    );
    assert_eq!(*focus.lock().unwrap(), strings(&["", "", "700"]));
}

#[test]
fn test_a_new_worker_window_opens_anyway_after_the_person_stays_busy() {
    setup();
    let host = window_host(vec![0.0], shared(Vec::new()));
    // The person never pauses; Brave's focus never moves.
    let start = host.monotonic();
    let directory = tempfile::tempdir().unwrap();
    let pool = BrowserTabPool::new(bridge(&host), queue(directory.path(), &host));
    assert_eq!(
        pool.open_window(Some("1"), "https://www.instagram.com/x/")
            .unwrap(),
        "55"
    );
    assert!(host.monotonic() - start >= control().worker_window_idle_wait_seconds);
}

#[test]
fn test_fourteen_native_navigations_are_spaced_without_losing_exact_targets() {
    setup();
    let interval = 0.02;
    overrides::instagram_browser(|control| control.navigation_interval_seconds = interval);
    let sent = shared(Vec::<(String, String, f64)>::new());
    let record = sent.clone();
    let clock: Shared<Option<Arc<FakeHost>>> = shared(None);
    let host_clock = clock.clone();
    let host = FakeHost::new(move |call| {
        assert!(call.runs(scripts::NAVIGATE_TAB));
        let arguments = call.script_arguments();
        // The dispatch time the spacing is kept on: nothing moves the clock between the
        // recorded dispatch and this send.
        let now = host_clock.lock().unwrap().as_ref().unwrap().monotonic();
        record
            .lock()
            .unwrap()
            .push((arguments[0].clone(), arguments[1].clone(), now));
        ok("navigating")
    });
    *clock.lock().unwrap() = Some(host.clone());
    let bridge = bridge(&host);
    let entered = Arc::new(Barrier::new(14));
    let workers: Vec<_> = (0..14)
        .map(|tab_id| {
            let bridge = bridge.clone();
            let entered = entered.clone();
            spawn(move || {
                entered.wait();
                pinned(&bridge, &tab_id.to_string(), "99")
                    .navigate(
                        &format!("https://www.instagram.com/p/POST{tab_id}/"),
                        2.0,
                        true,
                    )
                    .unwrap()
            })
        })
        .collect();
    let results: Vec<String> = workers
        .into_iter()
        .map(|worker| worker.join().unwrap().unwrap())
        .collect();
    *clock.lock().unwrap() = None;
    assert_eq!(results, vec!["navigating".to_owned(); 14]);
    let sent = sent.lock().unwrap();
    let mut targets: Vec<(String, String)> = sent
        .iter()
        .map(|(tab, url, _)| (tab.clone(), url.clone()))
        .collect();
    targets.sort();
    let mut expected: Vec<(String, String)> = (0..14)
        .map(|tab_id| {
            (
                tab_id.to_string(),
                format!("https://www.instagram.com/p/POST{tab_id}/"),
            )
        })
        .collect();
    expected.sort();
    assert_eq!(targets, expected);
    assert!(
        sent.windows(2)
            .all(|pair| pair[1].2 - pair[0].2 >= interval * 0.9)
    );
}

#[test]
fn test_navigation_spacing_wait_releases_transport_for_healthy_read() {
    setup();
    overrides::instagram_browser(|control| control.navigation_interval_seconds = 0.02);
    let pacing = Arc::new(Event::default());
    let read_done = Arc::new(Event::default());
    let host = FakeHost::new(|call| {
        ok(if call.runs(scripts::NAVIGATE_TAB) {
            "navigating"
        } else {
            "ready"
        })
    });
    let (paced, done) = (pacing.clone(), read_done.clone());
    let bridge = hooked_bridge(&host, move |_| {
        paced.set();
        assert!(
            done.wait(2.0),
            "Navigation spacing blocked healthy transport reads"
        );
    });
    *bridge.navigation_gate().lock() = Some(bridge.monotonic());
    let navigating = bridge.clone();
    let navigation = spawn(move || {
        pinned(&navigating, "2", "99")
            .navigate("https://www.instagram.com/p/POST/", 2.0, false)
            .unwrap()
    });
    assert!(pacing.wait(2.0));
    let mut reader = pinned(&bridge, "3", "99");
    reader.viewport_ready = true;
    assert_eq!(reader.run("read healthy exact tab", 1.0).unwrap(), "ready");
    read_done.set();
    assert_eq!(navigation.join().unwrap().unwrap(), "navigating");
    let scripts_run: Vec<bool> = host
        .calls()
        .iter()
        .map(|call| call.runs(scripts::EXECUTE_TAB))
        .collect();
    assert_eq!(scripts_run, vec![true, false]);
    assert!(host.calls()[1].runs(scripts::NAVIGATE_TAB));
}

#[test]
fn test_navigation_spacing_obeys_original_deadline_before_sending_mutation() {
    setup();
    overrides::instagram_browser(|control| control.navigation_interval_seconds = 1.0);
    let host = FakeHost::idle();
    let bridge = bridge(&host);
    let start = host.monotonic();
    *bridge.navigation_gate().lock() = Some(start);
    let mut runner = pinned(&bridge, "2", "99");
    let error = error_of(
        runner
            .navigate("https://www.instagram.com/p/POST/", 0.25, false)
            .unwrap(),
    );
    assert!(error.is(SessionKind::AutomationTransient));
    assert!(error.to_string().contains("timed out"));
    assert!(host.calls().is_empty(), "No native send");
    assert_eq!(host.monotonic() - start, 0.25);
    assert_eq!(*host.sleeps.lock().unwrap(), vec![0.25]);
    let gate = bridge
        .navigation_gate()
        .try_lock()
        .expect("the navigation gate is released");
    assert_eq!(*gate, Some(start));
}

#[test]
fn test_navigation_gate_and_transport_waits_consume_one_budget_before_dispatch() {
    setup();
    for waiting_owner in ["navigation", "transport"] {
        let sent = shared(Vec::<f64>::new());
        let record = sent.clone();
        let host = FakeHost::new(move |call| {
            assert!(call.runs(scripts::NAVIGATE_TAB));
            record.lock().unwrap().push(call.timeout);
            ok("navigating")
        });
        let bridge = bridge(&host);
        let start = host.monotonic();
        // Another owner holds the lock while 0.4 seconds pass.
        let held = Arc::new(Event::default());
        let release = Arc::new(Event::default());
        let holder = {
            let (bridge, host, held, release) =
                (bridge.clone(), host.clone(), held.clone(), release.clone());
            spawn(move || {
                if waiting_owner == "navigation" {
                    let _gate = bridge.navigation_gate().lock();
                    held.set();
                    release.wait(2.0);
                    host.advance(0.4);
                } else {
                    let _transport = bridge.transport().lock();
                    held.set();
                    release.wait(2.0);
                    host.advance(0.4);
                }
            })
        };
        assert!(held.wait(2.0));
        let navigating = bridge.clone();
        let navigation = spawn(move || {
            pinned(&navigating, "2", "99")
                .navigate("https://www.instagram.com/p/POST/", 1.0, false)
                .unwrap()
        });
        // Let the navigation start waiting on the held lock with its original budget.
        thread::sleep(Duration::from_millis(30));
        release.set();
        holder.join().unwrap();
        assert_eq!(navigation.join().unwrap().unwrap(), "navigating");
        assert_eq!(sent.lock().unwrap().len(), 1);
        assert!((sent.lock().unwrap()[0] - 0.6).abs() < 1e-9);
        assert_eq!(*bridge.navigation_gate().lock(), Some(start + 0.4));
    }
}

#[test]
fn test_uncertain_native_navigation_records_dispatch_but_is_never_repeated() {
    setup();
    let host = FakeHost::new(|_| timed_out());
    let bridge = bridge(&host);
    let mut runner = pinned(&bridge, "2", "99");
    let error = error_of(
        runner
            .navigate("https://www.instagram.com/p/POST/", 1.0, false)
            .unwrap(),
    );
    assert!(error.is(SessionKind::AutomationTransient));
    assert!(error.to_string().contains("timed out"));
    assert_eq!(host.calls().len(), 1);
    let gate = bridge
        .navigation_gate()
        .try_lock()
        .expect("the navigation gate is released");
    assert!(gate.is_some());
}

// ---------------------------------------------------------------------------------------
// Saved account entries

fn chooser_script(labels: &[&str], source: &str) -> String {
    format!(
        "const clicked = []; const labels = {};\
         const buttons = labels.map(label => ({{innerText: label, \
         scrollIntoView() {{}}, click() {{clicked.push(label);}}}}));\
         const dialog = {{querySelectorAll: () => buttons}};\
         const heading = {{innerText: 'Switch accounts', closest: () => dialog}};\
         global.document = {{querySelectorAll: () => [heading]}};\
         const status = {source};\
         console.log(JSON.stringify({{status, clicked}}));",
        json!(labels)
    )
}

#[test]
fn test_renamed_account_selects_saved_school_entry_without_guessing() {
    setup();
    let cases: [(&[&str], Option<&str>); 8] = [
        (&["dalhousie.wat2do.io"], Some("dalhousie.wat2do.io")),
        (&["dalhousie.wat2do.ca"], Some("dalhousie.wat2do.ca")),
        (&["other.wat2do.dalhousie"], None),
        (&["wat2do.dalhousie", "wat2do.dalhousie"], None),
        (&["wat2do.dalhousie"], Some("wat2do.dalhousie")),
        (
            &["dalhousie.wat2do.io", "wat2do.dalhousie"],
            Some("wat2do.dalhousie"),
        ),
        (&["other.wat2do.io"], None),
        (&["dalhousie.wat2do.io", "dalhousie.wat2do.io"], None),
    ];
    for (labels, expected) in cases {
        let script = chooser_script(labels, &scripts::click_account("wat2do.dalhousie"));
        let Some(result) = node_json(&script) else {
            return;
        };
        assert_eq!(
            result["clicked"],
            json!(expected.map_or_else(Vec::new, |label| vec![label])),
            "{labels:?}"
        );
        assert_eq!(result["status"] == json!("clicked"), expected.is_some());
    }
}

#[test]
fn test_configured_saved_chooser_label_never_changes_canonical_account_identity() {
    setup();
    assert_eq!(
        school_account_username("uwaterloo").unwrap(),
        "wat2do.uwaterloo"
    );
    let source = scripts::click_account("wat2do.uwaterloo");
    assert!(source.contains("const username = \"wat2do.uwaterloo\""));
    assert!(source.contains("const switcherUsername = \"wat2do.ca\""));
    if let Some(result) = node_json(&chooser_script(&["wat2do.ca", "wat2do.uwaterloo"], &source)) {
        assert_eq!(
            result,
            json!({"status": "clicked", "clicked": ["wat2do.ca"]})
        );
    }
}

#[test]
fn test_configured_saved_label_requires_canonical_active_username_and_recipient() {
    setup();
    for recipient_matches in [true, false] {
        let host = FakeHost::idle();
        let click = scripts::click_account("wat2do.uwaterloo");
        let extra: Extra = Box::new(move |account, source| {
            if source == click {
                assert!(source.contains("const switcherUsername = \"wat2do.ca\""));
                account.username = "wat2do.uwaterloo".to_owned();
                account.recipient = recipient_matches;
                account.chooser = false;
                return Some(Ok("clicked".to_owned()));
            }
            None
        });
        let (state, fake) = account_browser("wat2do.uwo", false, Some(extra));
        let mut session = session(&host, fake);
        let result = session.activate_account("41553815702", "wat2do.uwaterloo");
        if recipient_matches {
            assert_eq!(result.unwrap(), "wat2do.uwaterloo");
        } else {
            let error = error_of(result);
            assert!(error.is_session() && error.to_string().contains("does not match"));
        }
        assert!(
            state
                .lock()
                .unwrap()
                .sources
                .join("\n")
                .contains("activeRecipient === \"41553815702\"")
        );
    }
}

#[test]
fn test_saved_chooser_label_is_rejected_as_the_active_identity() {
    setup();
    let host = FakeHost::idle();
    let click = scripts::click_account("wat2do.uwaterloo");
    let clicked = click.clone();
    let extra: Extra = Box::new(move |account, source| {
        if source == clicked {
            account.username = "wat2do.ca".to_owned();
            account.recipient = true;
            account.chooser = false;
            return Some(Ok("clicked".to_owned()));
        }
        None
    });
    let (state, fake) = account_browser("wat2do.uwo", false, Some(extra));
    let mut session = session(&host, fake);
    let error = error_of(session.switch_account("wat2do.uwaterloo"));
    assert!(error.is(SessionKind::PageUnavailable));
    assert!(error.to_string().contains("timed out"));
    assert_eq!(count(&state.lock().unwrap().sources, &click), 1);
}

#[test]
fn test_saved_entry_selection_still_verifies_active_recipient() {
    setup();
    for recipient_matches in [true, false] {
        let host = FakeHost::idle();
        let click = scripts::click_account("wat2do.usask");
        let clicked = click.clone();
        let extra: Extra = Box::new(move |account, source| {
            if source == clicked {
                account.username = "wat2do.usask".to_owned();
                account.recipient = recipient_matches;
                account.chooser = false;
                return Some(Ok("clicked".to_owned()));
            }
            None
        });
        let (state, fake) = account_browser("wat2do.wlu", false, Some(extra));
        let mut session = session(&host, fake);
        let result = session.activate_account("41553815702", "wat2do.usask");
        if recipient_matches {
            assert_eq!(result.unwrap(), "wat2do.usask");
        } else {
            let error = error_of(result);
            assert!(error.is_session() && error.to_string().contains("does not match"));
        }
        assert_eq!(count(&state.lock().unwrap().sources, &click), 1);
    }
}

#[test]
fn test_parallel_session_refuses_to_switch_to_another_account() {
    setup();
    let host = FakeHost::idle();
    let fake = runner(|source, _| {
        assert!(
            !source.contains("Switch accounts"),
            "Tabs cannot switch accounts in parallel"
        );
        if source == scripts::CURRENT_ACCOUNT_USERNAME {
            return Ok("wat2do.ubc".to_owned());
        }
        panic!("{source}");
    });
    let mut session = session_with(&host, fake, false, None);
    let error = error_of(session.prepare_account("123", "wat2do.utm", false));
    assert!(error.is(SessionKind::AccountChanged));
    assert!(error.to_string().contains("account changed"));
}

#[test]
fn test_job_deadline_still_allows_confirmed_request_cancellation() {
    setup();
    let host = FakeHost::idle();
    let calls = shared(0usize);
    let seen = calls.clone();
    let fake = runner(move |_, _| {
        *seen.lock().unwrap() += 1;
        Ok("settled".to_owned())
    });
    let mut session = session_with(&host, fake, true, Some(1.0));
    host.advance(2.0);
    let error = error_of(session.run("must not run"));
    assert!(error.is_timeout() && error.to_string().contains("deadline"));
    session.cancel_pending_request().unwrap();
    assert_eq!(*calls.lock().unwrap(), 2);
    assert!(error_of(session.run("still expired")).is_timeout());
}

// ---------------------------------------------------------------------------------------
// The tab pool's preparation

/// A pool over a scripted Brave, with its queue in a temporary directory.
struct Pool {
    brave: Shared<Brave>,
    host: Arc<FakeHost>,
    pool: BrowserTabPool,
    queue: Arc<BrowserJobQueue>,
    _directory: tempfile::TempDir,
}

impl Pool {
    fn new(
        windows: Vec<(String, Vec<(String, String)>)>,
        registered: &[String],
        page: impl FnMut(&mut Brave, &str, &str) -> Result<CommandOutput, CommandError> + Send + 'static,
    ) -> Self {
        let brave = shared(Brave::new(windows));
        let host = brave_host(brave.clone(), page);
        let directory = tempfile::tempdir().unwrap();
        let queue = queue(directory.path(), &host);
        queue
            .set_setting("browser_tab_ids", json!(registered))
            .unwrap();
        Self {
            brave,
            pool: BrowserTabPool::new(bridge(&host), queue.clone()),
            host,
            queue,
            _directory: directory,
        }
    }

    fn setting(&self, key: &str) -> Value {
        self.queue.get_setting(key).unwrap().unwrap_or(Value::Null)
    }

    fn set(&self, key: &str, value: Value) {
        self.queue.set_setting(key, value).unwrap();
    }

    fn session(&self, tab_id: &str, allow_account_switch: bool) -> BrowserInstagramSession {
        BrowserInstagramSession::on_tab(&bridge(&self.host), tab_id, allow_account_switch, None)
    }
}

/// `tabs` registered worker tabs, `1` to `tabs`, each alone in its window on `url`.
fn registered_pool(
    tabs: usize,
    url: &str,
    page: impl FnMut(&mut Brave, &str, &str) -> Result<CommandOutput, CommandError> + Send + 'static,
) -> Pool {
    let ids: Vec<String> = (1..=tabs).map(|tab| tab.to_string()).collect();
    let windows = ids
        .iter()
        .map(|tab| {
            (
                (100 + tab.parse::<u64>().unwrap()).to_string(),
                vec![(tab.clone(), url.to_owned())],
            )
        })
        .collect();
    Pool::new(windows, &ids, page)
}

/// The tab of each page source matching `wanted`, consecutive repeats merged.
fn tabs_running(brave: &Brave, wanted: impl Fn(&str) -> bool) -> Vec<String> {
    let mut tabs: Vec<String> = Vec::new();
    for (tab, source) in &brave.sources {
        if wanted(source) && tabs.last() != Some(tab) {
            tabs.push(tab.clone());
        }
    }
    tabs
}

const UBC_PROFILE: &str = "https://www.instagram.com/wat2do.ubc/";

#[test]
fn test_pool_cancels_all_registered_tabs_before_switching_account() {
    setup();
    let pool = registered_pool(2, UBC_PROFILE, logged_in_page(|_| "wat2do.ubc".to_owned()));
    let (mut sessions, username) = pool
        .pool
        .prepare(&job("digest", "123", "wat2do.ubc"), 2)
        .unwrap();
    let brave = pool.brave.lock().unwrap();
    // Every tab settles before the primary verifies the account; only then the
    // secondary reloads.
    assert_eq!(
        tabs_running(&brave, |source| source == scripts::CANCEL_REQUEST)[..2],
        strings(&["1", "2"])
    );
    let first_switch = brave
        .sources
        .iter()
        .position(|(_, source)| *source == scripts::recipient_is_active("123"))
        .unwrap();
    assert!(
        brave.sources[..first_switch]
            .iter()
            .filter(|(_, source)| source == scripts::CANCEL_REQUEST)
            .count()
            >= 2
    );
    assert!(
        brave.sources[first_switch..]
            .iter()
            .all(|(tab, _)| tab == "1")
    );
    assert_eq!(
        brave.navigations,
        vec![("2".to_owned(), UBC_PROFILE.to_owned(), true)]
    );
    drop(brave);
    assert_eq!(
        sessions.iter_mut().map(tab_of).collect::<Vec<_>>(),
        strings(&["2"])
    );
    assert_eq!(username, "wat2do.ubc");
}

#[test]
fn test_public_pool_records_verified_bootstrap_hint_without_navigating_targets() {
    setup();
    let current = shared("wat2do.ubc".to_owned());
    let shown = current.clone();
    let pool = registered_pool(
        2,
        UBC_PROFILE,
        logged_in_page(move |_| shown.lock().unwrap().clone()),
    );
    let mut retrieval = job("retrieval", "123", "wat2do.ubc");
    retrieval.payload.insert(
        "url".to_owned(),
        json!("https://www.instagram.com/p/TARGET/"),
    );
    pool.pool.prepare(&retrieval, 2).unwrap();
    assert!(pool.brave.lock().unwrap().navigations.is_empty());
    assert_eq!(pool.setting("retrieval_pool_account"), json!("wat2do.ubc"));
    pool.pool.prepare(&retrieval, 2).unwrap();
    assert!(pool.brave.lock().unwrap().navigations.is_empty());
    *current.lock().unwrap() = "student.personal".to_owned();
    pool.pool.prepare(&retrieval, 2).unwrap();
    assert!(pool.brave.lock().unwrap().navigations.is_empty());
    assert_eq!(
        pool.setting("retrieval_pool_account"),
        json!("student.personal")
    );
}

/// `POST` from the ingestion tests, at `url`.
fn post(url: &str) -> Value {
    json!({
        "url": url,
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
fn test_fourteen_retrieval_slots_navigate_only_their_own_assigned_target() {
    setup();
    overrides::instagram_browser(|control| control.parallel_tabs = 15);
    let mut page = logged_in_page(|_| "wat2do.uwaterloo".to_owned());
    let pool = registered_pool(
        15,
        "https://www.instagram.com/wat2do.yorku/",
        move |brave, tab, source| {
            if source == scripts::REQUEST_STATE {
                let (_, url) = brave.find(tab).unwrap();
                return ok(&json!({
                    "result": {"state": "succeeded", "posts": [post(&url)]},
                    "settled": true,
                })
                .to_string());
            }
            if source.contains(scripts::REQUEST_KEY) && source.contains("/api/v1/media/") {
                return ok("started");
            }
            page(brave, tab, source)
        },
    );
    let ids: Vec<String> = (1..=15).map(|tab| tab.to_string()).collect();
    let targets: Vec<String> = (0..14)
        .map(|index| format!("https://www.instagram.com/p/TARGET{index}/"))
        .collect();
    let mut retrieval = job("retrieval", "123", "wat2do.uwaterloo");
    retrieval
        .payload
        .insert("url".to_owned(), json!(targets[0]));
    let (mut sessions, username) = pool.pool.prepare(&retrieval, 15).unwrap();
    assert!(pool.brave.lock().unwrap().navigations.is_empty());
    assert_eq!(username, "wat2do.uwaterloo");
    assert_eq!(
        sessions.iter_mut().map(tab_of).collect::<Vec<_>>(),
        ids[1..]
    );
    for (session, target) in sessions.iter_mut().zip(&targets) {
        let result = browser_ingestion::retrieve(session, target, 7).unwrap();
        assert_eq!(result["target_url"], json!(target));
        assert_eq!(result["posts"][0]["url"], json!(target));
    }
    let navigations: Vec<(String, String)> = pool
        .brave
        .lock()
        .unwrap()
        .navigations
        .iter()
        .map(|(tab, url, _)| (tab.clone(), url.clone()))
        .collect();
    assert_eq!(
        navigations,
        ids[1..]
            .iter()
            .cloned()
            .zip(targets.iter().cloned())
            .collect::<Vec<_>>()
    );
}

/// A session whose page answers identity reads from `username` and `logged_out`.
fn identity_session(
    host: &Arc<FakeHost>,
    mut username: impl FnMut() -> String + Send + 'static,
    logged_out: &'static str,
    reads: Shared<Vec<String>>,
) -> BrowserInstagramSession {
    session(
        host,
        runner(move |source, _| {
            reads.lock().unwrap().push(source.to_owned());
            if source == scripts::PAGE_RESPONSE {
                return Ok(json!({"path": "/wat2do.sfu/", "rate_limited": false}).to_string());
            }
            if source == scripts::CURRENT_ACCOUNT_USERNAME {
                return Ok(username());
            }
            if source == scripts::LOGGED_OUT {
                return Ok(logged_out.to_owned());
            }
            panic!("{source}");
        }),
    )
}

#[test]
fn test_pool_waits_for_username_and_captures_the_readable_value() {
    setup();
    let host = FakeHost::idle();
    let mut readings = vec!["", "", "wat2do.sfu"].into_iter();
    let reads = shared(Vec::new());
    let mut session = identity_session(
        &host,
        move || readings.next().expect("at most three reads").to_owned(),
        "false",
        reads.clone(),
    );
    assert_eq!(
        BrowserTabPool::ready_username(&mut session).unwrap(),
        "wat2do.sfu"
    );
    assert_eq!(
        count(&reads.lock().unwrap(), scripts::CURRENT_ACCOUNT_USERNAME),
        3
    );
}

#[test]
fn test_pool_unreadable_identity_is_transient_not_recovery() {
    setup();
    let host = FakeHost::idle();
    let mut session = identity_session(&host, String::new, "false", shared(Vec::new()));
    let error = error_of(BrowserTabPool::ready_username(&mut session));
    assert!(error.is_timeout());
    assert!(error.to_string().contains("temporarily unreadable"));
}

#[test]
fn test_logged_out_primary_asks_a_person_to_log_in_instead_of_retrying() {
    setup();
    let host = FakeHost::idle();
    let reads = shared(Vec::new());
    let mut session = identity_session(&host, String::new, "true", reads.clone());
    let error = error_of(BrowserTabPool::ready_username(&mut session));
    assert!(error.is_session());
    assert!(error.to_string().contains("log in to Instagram in Brave"));
    assert!(error.to_string().contains("human account recovery"));
    // The first poll recognizes the logged-out page, before the budget is spent.
    assert_eq!(count(&reads.lock().unwrap(), scripts::LOGGED_OUT), 1);
    assert!(host.sleeps.lock().unwrap().is_empty());
}

#[test]
fn test_fresh_primary_bootstrap_429_propagates_before_polling_missing_identity() {
    setup();
    let host = FakeHost::idle();
    let calls = shared(Vec::<String>::new());
    let seen = calls.clone();
    let mut session = session(
        &host,
        runner(move |source, _| {
            seen.lock().unwrap().push(source.to_owned());
            assert_eq!(source, scripts::PAGE_RESPONSE);
            Ok(json!({"path": "/", "rate_limited": true}).to_string())
        }),
    );
    let error = error_of(BrowserTabPool::ready_username(&mut session));
    assert!(error.is(SessionKind::RateLimited));
    assert!(error.to_string().contains("HTTP 429"));
    assert_eq!(*calls.lock().unwrap(), strings(&[scripts::PAGE_RESPONSE]));
}

#[test]
fn test_primary_public_bootstrap_recovers_blank_routes_and_preserves_auth_guards() {
    setup();
    overrides::instagram_browser(|control| control.parallel_tabs = 2);
    let cases: [(&str, Option<&str>); 9] = [
        ("/", Some("wat2do.uwaterloo")),
        ("/", Some("wat2do.yorku")),
        ("/p/PUBLIC/", Some("wat2do.uwaterloo")),
        ("/p/PUBLIC/", Some("wat2do.yorku")),
        ("/", Some("student.personal")),
        ("/accounts/login/", None),
        ("/accounts/suspended/", None),
        ("/challenge/", None),
        ("/checkpoint/", None),
    ];
    for (path, actual_username) in cases {
        let url = format!("https://www.instagram.com{path}");
        let windows = one_tab_windows(&[("101", "1", &url), ("102", "2", UBC_PROFILE)]);
        let pool = Pool::new(windows, &strings(&["1", "2"]), move |brave, tab, source| {
            assert_eq!(tab, "1");
            if source == scripts::CURRENT_PATH {
                return ok(&brave.path(tab));
            }
            if source == scripts::PAGE_RESPONSE {
                return ok(&json!({"path": brave.path(tab), "rate_limited": false}).to_string());
            }
            if source == scripts::CURRENT_ACCOUNT_USERNAME {
                let recovered = !brave.navigations.is_empty();
                return ok(if recovered {
                    actual_username.unwrap_or_default()
                } else {
                    ""
                });
            }
            if source == scripts::LOGGED_OUT {
                return ok("false");
            }
            // Recovery cannot change login.
            panic!("unexpected source: {source}");
        });
        pool.set("paused", json!("existing"));
        if actual_username == Some("student.personal") {
            pool.set("retrieval_pool_account", json!("student.personal"));
        }
        if let Some(actual) = actual_username {
            let bootstrap = (actual != "student.personal").then_some("wat2do.uwaterloo");
            assert_eq!(
                pool.pool.ensure_capacity(bootstrap).unwrap(),
                strings(&["1", "2"])
            );
            let destination = bootstrap.unwrap_or(actual);
            assert_eq!(
                pool.brave.lock().unwrap().navigations,
                vec![(
                    "1".to_owned(),
                    format!("https://www.instagram.com/{destination}/"),
                    true
                )]
            );
            let mut primary = pool.session("1", true);
            assert_eq!(
                BrowserTabPool::ready_username(&mut primary).unwrap(),
                actual
            );
        } else {
            let error = error_of(pool.pool.ensure_capacity(Some("wat2do.uwaterloo")));
            assert!(error.is_session(), "{path}");
            assert!(
                error.to_string().contains("human account recovery"),
                "{path}"
            );
            assert!(pool.brave.lock().unwrap().navigations.is_empty());
        }
        assert_eq!(pool.setting("paused"), json!("existing"));
    }
}

// ---------------------------------------------------------------------------------------
// Readiness and page routes

#[test]
fn test_readiness_waits_for_native_loading_then_reads_successfully() {
    setup();
    let host = FakeHost::idle();
    let mut session = BrowserInstagramSession::unpinned(&bridge(&host));
    let mut calls = 0;
    session
        .poll_until(|_| {
            calls += 1;
            if calls < 3 {
                return Err(BrowserError::page_unavailable(TAB_LOADING));
            }
            Ok(true)
        })
        .unwrap();
    assert_eq!(calls, 3);
    assert_eq!(host.sleeps.lock().unwrap().len(), 2);
}

#[test]
fn test_persistent_native_loading_obeys_readiness_deadline() {
    setup();
    let host = FakeHost::idle();
    let start = host.monotonic();
    let mut session = session_with(&host, runner(|_, _| unreachable!()), true, Some(1.0));
    let error = error_of(session.poll_until(|_| Err(BrowserError::page_unavailable(TAB_LOADING))));
    assert!(error.is(SessionKind::PageUnavailable));
    assert!(error.to_string().contains("automation timed out"));
    assert_eq!(host.monotonic() - start, 1.0);
}

#[test]
fn test_readiness_does_not_swallow_auth_account_or_desktop_errors() {
    setup();
    for error in [
        BrowserError::session("Instagram browser requires human account recovery"),
        BrowserError::account_changed("Instagram account changed"),
        BrowserError::page_unavailable("Instagram primary desktop viewport did not become ready"),
    ] {
        let host = FakeHost::idle();
        let mut session = BrowserInstagramSession::unpinned(&bridge(&host));
        let mut calls = 0;
        let raised = error_of(session.poll_until(|_| {
            calls += 1;
            Err(error.clone())
        }));
        assert_eq!(raised.type_name(), error.type_name());
        assert_eq!(raised.to_string(), error.to_string());
        assert_eq!(calls, 1);
        assert!(
            host.sleeps.lock().unwrap().is_empty(),
            "Never retry this error"
        );
    }
}

fn path_session(
    host: &Arc<FakeHost>,
    readings: Vec<&'static str>,
    calls: Shared<Vec<(String, f64)>>,
    job_timeout: Option<f64>,
) -> BrowserInstagramSession {
    let mut readings = readings.into_iter();
    session_with(
        host,
        runner(move |source, timeout| {
            calls.lock().unwrap().push((source.to_owned(), timeout));
            Ok(readings.next().expect("another reading").to_owned())
        }),
        true,
        job_timeout,
    )
}

#[test]
fn test_current_page_path_returns_normal_routes_without_grace_or_mutation() {
    setup();
    for path in ["/", "/wat2do.uwaterloo/", "/p/PUBLIC/"] {
        let host = FakeHost::idle();
        let calls = shared(Vec::new());
        let mut session = path_session(&host, vec![path], calls.clone(), None);
        assert_eq!(session.current_page_path(false).unwrap(), path);
        let sources: Vec<String> = calls.lock().unwrap().iter().map(|c| c.0.clone()).collect();
        assert_eq!(sources, strings(&["window.location.pathname"]));
        assert!(
            host.sleeps.lock().unwrap().is_empty(),
            "Normal routes need no grace"
        );
    }
}

#[test]
fn test_current_page_path_rejects_human_recovery_routes_immediately() {
    setup();
    for path in ["/accounts/suspended/", "/challenge/", "/checkpoint/"] {
        let host = FakeHost::idle();
        let calls = shared(Vec::new());
        let mut session = path_session(&host, vec![path], calls.clone(), None);
        let error = error_of(session.current_page_path(false));
        assert!(error.is_session() && error.to_string().contains("human account recovery"));
        assert_eq!(calls.lock().unwrap().len(), 1);
        assert!(
            host.sleeps.lock().unwrap().is_empty(),
            "Recovery must fail immediately"
        );
    }
}

#[test]
fn test_current_page_path_rechecks_transient_login_and_guards_the_fresh_route() {
    setup();
    for settled_path in ["/wat2do.uwaterloo/", "/accounts/login/", "/checkpoint/"] {
        let host = FakeHost::idle();
        let calls = shared(Vec::new());
        let mut session = path_session(
            &host,
            vec!["/accounts/login/", settled_path],
            calls.clone(),
            Some(10.0),
        );
        if settled_path.starts_with("/accounts/login") || settled_path.starts_with("/checkpoint") {
            let error = error_of(session.current_page_path(false));
            assert!(error.is_session() && error.to_string().contains("human account recovery"));
        } else {
            assert_eq!(session.current_page_path(false).unwrap(), settled_path);
        }
        assert_eq!(
            *host.sleeps.lock().unwrap(),
            vec![control().account_transition_grace_seconds]
        );
        let sources: Vec<String> = calls.lock().unwrap().iter().map(|c| c.0.clone()).collect();
        assert_eq!(sources, strings(&["window.location.pathname"; 2]));
    }
}

#[test]
fn test_current_page_path_login_grace_obeys_remaining_job_deadline() {
    setup();
    let host = FakeHost::idle();
    let start = host.monotonic();
    let calls = shared(Vec::new());
    let mut session = path_session(
        &host,
        vec!["/accounts/login/"; 2],
        calls.clone(),
        Some(0.25),
    );
    let error = error_of(session.current_page_path(false));
    assert!(error.is_timeout() && error.to_string().contains("job exceeded its deadline"));
    assert_eq!(*host.sleeps.lock().unwrap(), vec![0.25]);
    assert_eq!(host.monotonic() - start, 0.25);
    assert_eq!(
        *calls.lock().unwrap(),
        vec![("window.location.pathname".to_owned(), 0.25)]
    );
}

#[test]
fn test_page_response_only_recognizes_verified_complete_chromium_429() {
    setup();
    let cases: [(&str, &str, Option<&str>, bool); 6] = [
        (
            "complete",
            "www.instagram.com",
            Some("HTTP ERROR 429"),
            true,
        ),
        (
            "loading",
            "www.instagram.com",
            Some("HTTP ERROR 429"),
            false,
        ),
        ("complete", "Instagram", Some("HTTP ERROR 429"), false),
        (
            "complete",
            "www.instagram.com",
            Some("HTTP ERROR 500"),
            false,
        ),
        ("complete", "www.instagram.com", Some("429"), false),
        ("complete", "www.instagram.com", None, false),
    ];
    for (ready_state, title, error_code, expected) in cases {
        let script = format!(
            r##"
 const code = {code};
 global.window = {{location: {{pathname: "/"}}}};
 global.document = {{
  readyState: {ready}, title: {title},
  body: {{innerText: "This Instagram caption says HTTP ERROR 429"}},
  querySelector(selector) {{
   if (selector !== "#main-frame-error .error-code") throw new Error("Unscoped selector");
   return code === null ? null : {{textContent: code}};
  }}
 }};
 console.log({source});
 "##,
            code = json!(error_code),
            ready = json!(ready_state),
            title = json!(title),
            source = scripts::PAGE_RESPONSE,
        );
        let Some(result) = node_json(&script) else {
            return;
        };
        assert_eq!(result, json!({"path": "/", "rate_limited": expected}));
    }
}

#[test]
fn test_post_response_429_raises_typed_error_before_context_read_or_action() {
    setup();
    let host = FakeHost::idle();
    let calls = shared(Vec::<String>::new());
    let navigated = shared(false);
    let (seen, page_navigated) = (calls.clone(), navigated.clone());
    let fake = runner(move |source, _| {
        if !*page_navigated.lock().unwrap() {
            // The account check before navigating.
            if source == scripts::CURRENT_ACCOUNT_USERNAME {
                return Ok("wat2do.uwaterloo".to_owned());
            }
            assert_eq!(source, scripts::recipient_is_active("123"));
            return Ok("true".to_owned());
        }
        seen.lock().unwrap().push(source.to_owned());
        assert_eq!(source, scripts::PAGE_RESPONSE);
        Ok(json!({"path": "/", "rate_limited": true}).to_string())
    })
    .navigating(move |_, _, _| {
        *navigated.lock().unwrap() = true;
        Ok("navigating".to_owned())
    });
    let error = error_of(session(&host, fake).navigate_post(
        "https://www.instagram.com/p/POST/",
        "123",
        "wat2do.uwaterloo",
    ));
    assert!(error.is(SessionKind::RateLimited) && error.to_string().contains("HTTP 429"));
    assert_eq!(*calls.lock().unwrap(), strings(&[scripts::PAGE_RESPONSE]));
}

#[test]
fn test_page_response_rejects_malformed_state_without_claiming_rate_limit() {
    setup();
    for response in [
        Value::Null,
        json!({}),
        json!({"path": "/", "rate_limited": "true"}),
        json!({"path": null, "rate_limited": false}),
    ] {
        let host = FakeHost::idle();
        let reply = response.to_string();
        let mut session = session(&host, runner(move |_, _| Ok(reply.clone())));
        let error = error_of(session.current_page_path(true));
        assert!(error.is_session() && error.to_string().contains("invalid page response"));
        assert!(!error.is(SessionKind::RateLimited));
    }
}

#[test]
fn test_page_response_login_recheck_preserves_fresh_auth_route_guard() {
    setup();
    for settled_path in ["/p/POST/", "/checkpoint/"] {
        let host = FakeHost::idle();
        let mut readings = vec!["/accounts/login/", settled_path].into_iter();
        let mut session = session(
            &host,
            runner(move |_, _| {
                Ok(json!({"path": readings.next().unwrap(), "rate_limited": false}).to_string())
            }),
        );
        if settled_path == "/checkpoint/" {
            let error = error_of(session.current_page_path(true));
            assert!(error.is_session() && error.to_string().contains("human account recovery"));
        } else {
            assert_eq!(session.current_page_path(true).unwrap(), settled_path);
        }
    }
}

// ---------------------------------------------------------------------------------------
// Cleanup retries and the transport

#[test]
fn test_query_recovers_transient_cleanup_bridge_failure_without_repeating_request() {
    setup();
    let host = FakeHost::idle();
    let state = shared((false, 0usize, 0usize)); // (started, failures, starts)
    let seen = state.clone();
    let fake = runner(move |source, timeout| {
        let mut state = seen.lock().unwrap();
        assert!(timeout <= control().interaction_timeout_seconds);
        if source == scripts::CANCEL_REQUEST {
            if state.0 && state.1 < 2 {
                state.1 += 1;
                return Err(BrowserError::transient(
                    "Brave could not run Instagram browser automation",
                ));
            }
            return Ok("settled".to_owned());
        }
        if source == scripts::CLEAR_REQUEST {
            return Ok("cleared".to_owned());
        }
        if source == "start request" {
            state.2 += 1;
            state.0 = true;
            return Ok("started".to_owned());
        }
        if source == scripts::REQUEST_STATE {
            return Ok(
                r#"{"result":{"state":"succeeded","media_ids":["123"]},"settled":true}"#.to_owned(),
            );
        }
        panic!("{source}");
    });
    let mut session = session(&host, fake);
    assert_eq!(
        session.query("start request", true).unwrap()["media_ids"],
        json!(["123"])
    );
    session.cancel_pending_request().unwrap();
    let state = state.lock().unwrap();
    assert_eq!(state.2, 1);
    assert_eq!(state.1, 2);
    assert_eq!(host.sleeps.lock().unwrap().len(), 2);
}

#[test]
fn test_cleanup_bridge_retry_exhaustion_keeps_account_switch_blocked() {
    setup();
    let host = FakeHost::idle();
    let calls = shared(Vec::<String>::new());
    let seen = calls.clone();
    let fake = runner(move |source, _| {
        seen.lock().unwrap().push(source.to_owned());
        Err(BrowserError::transient(
            "Brave could not run Instagram browser automation",
        ))
    });
    let error = error_of(session(&host, fake).activate_account("41553815702", "usask.wat2do.io"));
    assert!(error.is_session());
    assert!(
        error
            .to_string()
            .contains("cancellation could not be confirmed")
    );
    let calls = calls.lock().unwrap();
    assert_eq!(calls.len(), control().bridge_retry_limit);
    assert!(calls.iter().all(|source| source == scripts::CANCEL_REQUEST));
}

#[test]
fn test_cleanup_bridge_retries_share_one_deadline_and_restore_job_deadline() {
    setup();
    let host = FakeHost::idle();
    let start = host.monotonic();
    let timeouts = shared(Vec::<f64>::new());
    let (seen, clock) = (timeouts.clone(), host.clone());
    let fake = runner(move |_, timeout| {
        seen.lock().unwrap().push(timeout);
        clock.advance(timeout);
        Err(BrowserError::transient(TIMED_OUT))
    });
    let mut session = session_with(&host, fake, true, Some(1.0));
    let error = error_of(session.cancel_pending_request());
    assert!(error.is_session());
    assert!(
        error
            .to_string()
            .contains("cancellation could not be confirmed")
    );
    assert_eq!(timeouts.lock().unwrap().len(), 1);
    assert_eq!(
        host.monotonic() - start,
        control().interaction_timeout_seconds
    );
    let error = error_of(session.run("never execute"));
    assert!(error.is_timeout() && error.to_string().contains("deadline"));
}

#[test]
fn test_applescript_error_reports_only_numeric_code() {
    setup();
    let host = FakeHost::new(|_| failed("sensitive page text (-600)"));
    let error = error_of(bridge(&host).run_applescript("source", &[], 1.0, false));
    assert!(error.is_session());
    assert!(error.to_string().contains("Apple Event -600"));
    assert!(!error.to_string().contains("sensitive"));
}

#[test]
fn test_closed_owned_document_is_settled_without_retargeting_tab() {
    setup();
    let host = FakeHost::idle();
    let calls = shared(Vec::<String>::new());
    let seen = calls.clone();
    let fake = runner(move |source, _| {
        seen.lock().unwrap().push(source.to_owned());
        Err(BrowserError::session(TAB_CLOSED))
    });
    session(&host, fake).cancel_pending_request().unwrap();
    assert_eq!(*calls.lock().unwrap(), strings(&[scripts::CANCEL_REQUEST]));
}

#[test]
fn test_applescript_transport_serializes_parallel_tabs_without_serializing_jobs() {
    setup();
    let running = shared((0usize, 0usize, Vec::<String>::new())); // (running, maximum, calls)
    let seen = running.clone();
    let host = FakeHost::new(move |call| {
        {
            let mut state = seen.lock().unwrap();
            state.0 += 1;
            state.1 = state.1.max(state.0);
            state.2.push(call.args.last().unwrap().clone());
        }
        thread::sleep(Duration::from_millis(5));
        seen.lock().unwrap().0 -= 1;
        ok("started")
    });
    let bridge = bridge(&host);
    let entered = Arc::new(Barrier::new(14));
    let workers: Vec<_> = (0..14)
        .map(|tab_id| {
            let (bridge, entered) = (bridge.clone(), entered.clone());
            spawn(move || {
                entered.wait();
                bridge.run_applescript(
                    "start one async page request",
                    &[tab_id.to_string()],
                    3.0,
                    false,
                )
            })
        })
        .collect();
    let results: Vec<String> = workers
        .into_iter()
        .map(|worker| worker.join().unwrap().unwrap())
        .collect();
    assert_eq!(results, vec!["started".to_owned(); 14]);
    let state = running.lock().unwrap();
    let mut distinct = state.2.clone();
    distinct.sort();
    distinct.dedup();
    assert_eq!(distinct.len(), 14);
    assert_eq!(state.1, 1);
}

#[test]
fn test_transport_lock_wait_and_event_cap_share_the_original_call_budget() {
    setup();
    for (call_budget, lock_wait, event_cap, execution_budget) in [
        (1.0, 0.4, 3.0, 0.6),
        (30.0, 0.0, 3.0, 3.0),
        (1.0, 0.4, 0.2, 0.2),
    ] {
        overrides::instagram_browser(|control| control.apple_event_timeout_seconds = event_cap);
        let seen = shared(Vec::<f64>::new());
        let record = seen.clone();
        let host = FakeHost::new(move |call| {
            record.lock().unwrap().push(call.timeout);
            ok("ready")
        });
        let bridge = bridge(&host);
        let release = Arc::new(Event::default());
        let held = Arc::new(Event::default());
        let holder = (lock_wait > 0.0).then(|| {
            let (bridge, host, held, release) =
                (bridge.clone(), host.clone(), held.clone(), release.clone());
            spawn(move || {
                let _transport = bridge.transport().lock();
                held.set();
                release.wait(2.0);
                // The lock wait spends part of the call's budget.
                host.advance(lock_wait);
            })
        });
        if holder.is_some() {
            assert!(held.wait(2.0));
        }
        let reading = bridge.clone();
        let read = spawn(move || reading.run_applescript("read", &[], call_budget, false));
        if let Some(holder) = holder {
            thread::sleep(Duration::from_millis(30));
            release.set();
            holder.join().unwrap();
        }
        assert_eq!(read.join().unwrap().unwrap(), "ready");
        let seen = seen.lock().unwrap();
        assert_eq!(seen.len(), 1);
        assert!(
            (seen[0] - execution_budget).abs() < 1e-9,
            "{seen:?} != {execution_budget}"
        );
    }
}

#[test]
fn test_stalled_native_event_releases_transport_before_thirteen_healthy_reads_expire() {
    setup();
    let event_cap = 0.03;
    overrides::instagram_browser(|control| control.apple_event_timeout_seconds = event_cap);
    let entered = Arc::new(Event::default());
    let events = shared(Vec::<(String, f64)>::new());
    let (stalled_entered, record) = (entered.clone(), events.clone());
    let host = FakeHost::new(move |call| {
        let tab_id = call.args.last().unwrap().clone();
        record.lock().unwrap().push((tab_id.clone(), call.timeout));
        if tab_id == "stalled" {
            stalled_entered.set();
            // Honor the actual subprocess execution budget.
            thread::sleep(Duration::from_secs_f64(call.timeout));
            return timed_out();
        }
        ok("ready")
    });
    let bridge = bridge(&host);
    let stalling = bridge.clone();
    let stalled = spawn(move || {
        stalling.run_applescript("read one pinned tab", &strings(&["stalled"]), 1.0, false)
    });
    assert!(entered.wait(2.0));
    let started = Arc::new(Barrier::new(13));
    let healthy: Vec<_> = (0..13)
        .map(|tab_id| {
            let (bridge, started) = (bridge.clone(), started.clone());
            spawn(move || {
                started.wait();
                bridge.run_applescript("read one pinned tab", &[tab_id.to_string()], 0.2, false)
            })
        })
        .collect();
    let results: Vec<String> = healthy
        .into_iter()
        .map(|worker| worker.join().unwrap().unwrap())
        .collect();
    let error = error_of(stalled.join().unwrap());
    assert!(error.is(SessionKind::AutomationTransient) && error.to_string().contains("timed out"));
    assert_eq!(results, vec!["ready".to_owned(); 13]);
    let events = events.lock().unwrap();
    let mut tabs: Vec<&String> = events.iter().map(|(tab, _)| tab).collect();
    tabs.sort();
    tabs.dedup();
    assert_eq!(events.len(), 14);
    assert_eq!(tabs.len(), 14);
    assert!(
        events
            .iter()
            .all(|(_, timeout)| 0.0 < *timeout && *timeout <= event_cap)
    );
}

#[test]
fn test_transport_timeout_waiting_for_lock_never_sends_an_event() {
    setup();
    let host = FakeHost::idle();
    let bridge = bridge(&host);
    let held = Arc::new(Event::default());
    let release = Arc::new(Event::default());
    let holder = {
        let (bridge, held, release) = (bridge.clone(), held.clone(), release.clone());
        spawn(move || {
            let _transport = bridge.transport().lock();
            held.set();
            release.wait(2.0);
        })
    };
    assert!(held.wait(2.0));
    let error = error_of(bridge.run_applescript("never execute", &[], 0.05, false));
    release.set();
    holder.join().unwrap();
    assert!(error.is(SessionKind::AutomationTransient) && error.to_string().contains("timed out"));
    assert!(host.calls().is_empty(), "No event");
}

#[test]
fn test_pinned_execution_never_resolves_unrelated_tabs_or_rediscovers_a_closed_target() {
    setup();
    let host = FakeHost::new(|call| {
        if call.runs(scripts::EXECUTE_TAB) {
            let script = call.script().unwrap();
            assert!(!script.contains("every tab") && !script.contains("every window"));
            assert_eq!(arguments(call), strings(&["42", "read target", "99"]));
        } else {
            assert!(call.runs(scripts::WORKER_WINDOW));
            assert_eq!(arguments(call), strings(&["42"]));
        }
        failed("execution error: Pinned Instagram tab is closed. (-2700)")
    });
    let bridge = bridge(&host);
    let mut runner = pinned(&bridge, "42", "99");
    runner.viewport_ready = true;
    for _ in 0..2 {
        let error = error_of(runner.run("read target", 1.0));
        assert!(error.is_session() && error.to_string().contains("tab was closed"));
    }
    assert_eq!(host.calls().len(), 4);
}

#[test]
fn test_pinned_tab_moved_during_request_cannot_be_treated_as_cancelled() {
    setup();
    let host = FakeHost::new(|call| {
        if call.runs(scripts::EXECUTE_TAB) {
            return failed("execution error: Pinned Instagram tab is closed. (-2700)");
        }
        assert!(call.runs(scripts::WORKER_WINDOW));
        assert_eq!(arguments(call), strings(&["42"]));
        ok("100")
    });
    let bridge = bridge(&host);
    let tab = pinned(&bridge, "42", "99");
    let error = error_of(
        BrowserInstagramSession::new(bridge, Box::new(tab), true, None).cancel_pending_request(),
    );
    assert!(error.is_session());
    assert!(
        error
            .to_string()
            .contains("cancellation could not be confirmed")
    );
    let calls = host.calls();
    assert_eq!(calls.len(), 2);
    assert!(calls[0].runs(scripts::EXECUTE_TAB) && calls[1].runs(scripts::WORKER_WINDOW));
}

#[test]
fn test_read_retries_transient_bridge_errors_with_one_decreasing_budget() {
    setup();
    let host = FakeHost::idle();
    let calls = shared(Vec::<(String, f64)>::new());
    let seen = calls.clone();
    let fake = runner(move |source, timeout| {
        let mut calls = seen.lock().unwrap();
        calls.push((source.to_owned(), timeout));
        if calls.len() < 3 {
            return Err(BrowserError::transient("Apple Event -1719"));
        }
        Ok("ready".to_owned())
    });
    let mut session = session_with(&host, fake, true, Some(1.0));
    assert_eq!(session.read("read identity").unwrap(), "ready");
    assert_eq!(
        *calls.lock().unwrap(),
        vec![
            ("read identity".to_owned(), 1.0),
            ("read identity".to_owned(), 0.75),
            ("read identity".to_owned(), 0.5),
        ]
    );
}

#[test]
fn test_uncertain_click_is_never_repeated_by_session_or_pinned_runner() {
    setup();
    let host = FakeHost::new(|_| timed_out());
    let bridge = bridge(&host);
    let mut tab = pinned(&bridge, "42", "99");
    tab.viewport_ready = true;
    let mut session = BrowserInstagramSession::new(bridge, Box::new(tab), true, None);
    let error = error_of(session.run("engagementButton.click()"));
    assert!(error.is(SessionKind::AutomationTransient) && error.to_string().contains("timed out"));
    let calls = host.calls();
    assert_eq!(calls.len(), 1);
    assert_eq!(
        arguments(&calls[0]),
        strings(&["42", "engagementButton.click()", "99"])
    );
}

#[test]
fn test_read_exhausting_call_budget_does_not_start_another_attempt() {
    setup();
    let host = FakeHost::idle();
    let calls = shared(Vec::<f64>::new());
    let (seen, clock) = (calls.clone(), host.clone());
    let fake = runner(move |_, timeout| {
        seen.lock().unwrap().push(timeout);
        clock.advance(timeout);
        Err(BrowserError::transient(TIMED_OUT))
    });
    let mut session = session_with(&host, fake, true, Some(1.0));
    let error = error_of(session.read("read identity"));
    assert!(error.is(SessionKind::AutomationTransient));
    assert_eq!(*calls.lock().unwrap(), vec![1.0]);
    assert!(host.sleeps.lock().unwrap().is_empty(), "No budget remains");
}

#[test]
fn test_script_programming_errors_are_not_transient_or_retried() {
    setup();
    let host = FakeHost::new(|_| failed("sensitive syntax (-2741)"));
    let bridge = bridge(&host);
    let tab = pinned(&bridge, "42", "99");
    let mut session = BrowserInstagramSession::new(bridge, Box::new(tab), true, None);
    let error = error_of(session.read("read identity"));
    assert!(error.is_session() && error.to_string().contains("Apple Event -2741"));
    assert!(!error.is(SessionKind::AutomationTransient));
    assert_eq!(host.calls().len(), 1);
    assert!(!error.to_string().contains("sensitive"));
}

#[test]
fn test_account_chooser_close_is_scoped_and_unambiguous() {
    setup();
    for close_count in [0, 1, 2] {
        let script = format!(
            "const clicked = []; const otherClose = {{closest: () => ({{click: () => clicked.push('post')}})}};\
             const chooserClose = {{closest: () => ({{click: () => clicked.push('chooser')}})}};\
             const dialog = {{querySelectorAll: () => Array({close_count}).fill(chooserClose)}};\
             const heading = {{innerText: 'Switch accounts', closest: () => dialog}};\
             global.document = {{querySelector: () => otherClose, querySelectorAll: () => [heading]}};\
             const status = {};\
             console.log(JSON.stringify({{status, clicked}}));",
            scripts::CLOSE_ACCOUNT_CHOOSER
        );
        let Some(result) = node_json(&script) else {
            return;
        };
        assert_eq!(
            result,
            json!({
                "status": if close_count == 1 { "clicked" } else { "missing" },
                "clicked": if close_count == 1 { vec!["chooser"] } else { vec![] },
            })
        );
    }
}

/// The page's own navigation, showing the active account.
const OWN_NAVIGATION: &str =
    "<nav><a href='/wat2do.yorku/'><img alt=\"wat2do.yorku's profile picture\"></a></nav>";
/// Switch accounts with other accounts saved: the chooser.
const ACCOUNT_CHOOSER: &str = "<div role='dialog'><div><h2>Switch accounts</h2>\
     <div role='button' id='close'><svg aria-label='Close'><title>Close</title></svg></div></div>\
     <div role='button' id='guelph'>wat2do.guelph</div>\
     <button id='existing'>Log into an Existing Account</button></div>";
/// Switch accounts with no other account saved, as Brave showed it on 11-09: an empty
/// heading, the login inputs and the buttons "Close", "Save login info", "Log in" and
/// "Forgot password?".
const BARE_LOGIN_FORM: &str = "<div role='dialog'>\
     <div role='button' id='close'><svg aria-label='Close'><title>Close</title></svg></div>\
     <h1></h1><form><input name='username' type='text'><input name='password' type='password'>\
     <input name='LoginCheckbox' type='checkbox'>\
     <div role='button' id='save'>Save login info</div><button id='log-in'>Log in</button>\
     <div role='button' id='forgot'>Forgot password?</div></form></div>";
/// A post opened in a dialog, which has its own Close.
const POST_DIALOG: &str = "<div role='dialog'>\
     <div role='button' id='post-close'><svg aria-label='Close'><title>Close</title></svg></div>\
     <article>a post</article></div>";
/// Instagram's logged-out login page: a password field, but no dialog.
const LOGIN_PAGE: &str = "<main><form><input name='username' type='text'>\
     <input name='password' type='password'><button id='log-in'>Log in</button></form></main>";

#[test]
fn test_account_chooser_state_tells_the_chooser_from_the_bare_login_form() {
    setup();
    for (html, expected) in [
        (format!("{OWN_NAVIGATION}{ACCOUNT_CHOOSER}"), "ready"),
        (format!("{OWN_NAVIGATION}{BARE_LOGIN_FORM}"), "login"),
        (format!("{OWN_NAVIGATION}{POST_DIALOG}"), "pending"),
        (OWN_NAVIGATION.to_owned(), "pending"),
        (LOGIN_PAGE.to_owned(), "pending"),
    ] {
        let Some(result) = evaluate_on_page(&html, scripts::ACCOUNT_CHOOSER_STATE) else {
            return;
        };
        assert_eq!(result["status"], json!(expected), "{html}");
    }
}

#[test]
fn test_account_chooser_close_also_closes_the_bare_login_form() {
    setup();
    for (html, status, clicked) in [
        (
            format!("{OWN_NAVIGATION}{ACCOUNT_CHOOSER}"),
            "clicked",
            vec!["close"],
        ),
        (
            format!("{OWN_NAVIGATION}{BARE_LOGIN_FORM}"),
            "clicked",
            vec!["close"],
        ),
        // Only Switch accounts' own dialog is ever closed.
        (format!("{OWN_NAVIGATION}{POST_DIALOG}"), "missing", vec![]),
        (LOGIN_PAGE.to_owned(), "missing", vec![]),
        (
            format!("{OWN_NAVIGATION}{BARE_LOGIN_FORM}{BARE_LOGIN_FORM}"),
            "missing",
            vec![],
        ),
    ] {
        let Some(result) = evaluate_on_page(&html, scripts::CLOSE_ACCOUNT_CHOOSER) else {
            return;
        };
        assert_eq!(
            result,
            json!({"status": status, "clicks": clicked}),
            "{html}"
        );
    }
}

// ---------------------------------------------------------------------------------------
// Account activation fallbacks

#[test]
fn test_primary_page_recovery_uses_native_intended_profile_without_home() {
    setup();
    let host = FakeHost::idle();
    let state = shared((Vec::<String>::new(), Vec::<(String, bool)>::new()));
    let (seen, navigated) = (state.clone(), state.clone());
    let fake = runner(move |source, _| {
        let mut state = seen.lock().unwrap();
        state.0.push(source.to_owned());
        let recovered = !state.1.is_empty();
        if source == scripts::CANCEL_REQUEST {
            return Ok("settled".to_owned());
        }
        if source == scripts::CLEAR_REQUEST {
            return Ok("cleared".to_owned());
        }
        if source == scripts::PAGE_RESPONSE {
            assert!(recovered, "only the recovered page is checked");
            return Ok(json!({"path": "/usask.wat2do.io/", "rate_limited": false}).to_string());
        }
        if source == scripts::CURRENT_ACCOUNT_USERNAME {
            // Temporarily missing controls until the intended profile loads.
            return Ok(if recovered { "usask.wat2do.io" } else { "" }.to_owned());
        }
        if source == scripts::recipient_is_active("41553815702") {
            return Ok("true".to_owned());
        }
        if source == scripts::ACCOUNT_CHOOSER_STATE {
            return Ok("pending".to_owned());
        }
        panic!("{source}");
    })
    .navigating(move |url, _, reload| {
        navigated.lock().unwrap().1.push((url.to_owned(), reload));
        Ok("navigating".to_owned())
    });
    assert_eq!(
        session(&host, fake)
            .activate_account("41553815702", "usask.wat2do.io")
            .unwrap(),
        "usask.wat2do.io"
    );
    let state = state.lock().unwrap();
    assert_eq!(
        state.1,
        vec![(
            "https://www.instagram.com/usask.wat2do.io/".to_owned(),
            true
        )]
    );
    // No page-side navigation home (the route check reads `location.pathname` only).
    assert!(
        !state
            .0
            .iter()
            .filter(|source| *source != scripts::PAGE_RESPONSE)
            .any(|source| source.contains("location"))
    );
}

#[test]
fn test_fresh_account_profile_fallback_429_stops_before_another_control_click() {
    setup();
    overrides::instagram_browser(|control| control.interaction_timeout_seconds = 0.5);
    let host = FakeHost::idle();
    let start = host.monotonic();
    let state = shared((Vec::<(String, bool)>::new(), 0usize)); // (navigations, responses)
    let (seen, navigated) = (state.clone(), state.clone());
    let fake = runner(move |source, _| {
        let mut state = seen.lock().unwrap();
        if source == scripts::PAGE_RESPONSE {
            state.1 += 1;
            return Ok(json!({"path": "/", "rate_limited": true}).to_string());
        }
        if source == scripts::CANCEL_REQUEST {
            return Ok("settled".to_owned());
        }
        if source == scripts::CLEAR_REQUEST {
            return Ok("cleared".to_owned());
        }
        assert_eq!(source, scripts::CURRENT_ACCOUNT_USERNAME);
        assert!(state.0.is_empty());
        Ok(String::new())
    })
    .navigating(move |url, _, reload| {
        navigated.lock().unwrap().0.push((url.to_owned(), reload));
        Ok("navigating".to_owned())
    });
    let error = error_of(session(&host, fake).activate_account("41553815702", "wat2do.uwaterloo"));
    assert!(error.is(SessionKind::RateLimited) && error.to_string().contains("HTTP 429"));
    assert_eq!(host.monotonic() - start, 0.5);
    let state = state.lock().unwrap();
    assert_eq!(
        state.0,
        vec![(
            "https://www.instagram.com/wat2do.uwaterloo/".to_owned(),
            true
        )]
    );
    assert_eq!(state.1, 1);
}

#[test]
fn test_new_429_after_one_account_switch_click_propagates_without_profile_reload() {
    setup();
    let host = FakeHost::idle();
    let extra: Extra = Box::new(|_, source| {
        (source == scripts::PAGE_RESPONSE)
            .then(|| Ok(json!({"path": "/", "rate_limited": true}).to_string()))
    });
    let (state, fake) = account_browser("ulaval.wat2do.io", false, Some(extra));
    let fake = fake.navigating(|_, _, _| {
        panic!("A fresh switch 429 must not immediately reload another profile")
    });
    let error = error_of(session(&host, fake).activate_account("41553815702", "usask.wat2do.io"));
    assert!(error.is(SessionKind::RateLimited) && error.to_string().contains("HTTP 429"));
    let sources = state.lock().unwrap().sources.clone();
    assert_eq!(
        count(&sources, &scripts::click_account("usask.wat2do.io")),
        1
    );
    assert_eq!(count(&sources, scripts::PAGE_RESPONSE), 1);
}

#[test]
fn test_polling_caps_reads_to_interaction_deadline_and_restores_job_budget() {
    setup();
    overrides::instagram_browser(|control| control.interaction_timeout_seconds = 1.0);
    let host = FakeHost::idle();
    let timeouts = shared(Vec::<f64>::new());
    let (seen, clock) = (timeouts.clone(), host.clone());
    let fake = runner(move |_, timeout| {
        seen.lock().unwrap().push(timeout);
        clock.advance(timeout);
        Ok("pending".to_owned())
    });
    let mut session = session_with(&host, fake, true, Some(10.0));
    let error =
        error_of(session.poll_until(|session| Ok(session.read("read request state")? == "ready")));
    assert!(error.is(SessionKind::PageUnavailable));
    assert_eq!(*timeouts.lock().unwrap(), vec![1.0]);
    assert_eq!(session.remaining_timeout().unwrap(), 9.0);
}

#[test]
fn test_fifteen_tab_pool_reserves_primary_and_assigns_all_fourteen_secondary_tabs() {
    setup();
    overrides::instagram_browser(|control| control.parallel_tabs = 15);
    let pool = registered_pool(15, UBC_PROFILE, logged_in_page(|_| "wat2do.ubc".to_owned()));
    let ids: Vec<String> = (1..=15).map(|tab| tab.to_string()).collect();
    let (mut sessions, username) = pool
        .pool
        .prepare(&job("digest", "123", "wat2do.ubc"), 15)
        .unwrap();
    assert_eq!(username, "wat2do.ubc");
    assert_eq!(
        sessions.iter_mut().map(tab_of).collect::<Vec<_>>(),
        ids[1..]
    );
    let brave = pool.brave.lock().unwrap();
    assert_eq!(
        tabs_running(&brave, |source| source == scripts::CANCEL_REQUEST)[..15],
        ids[..]
    );
    let switch = brave
        .sources
        .iter()
        .position(|(_, source)| *source == scripts::recipient_is_active("123"))
        .unwrap();
    assert_eq!(brave.sources[switch].0, "1");
    assert_eq!(
        brave.navigations,
        ids[1..]
            .iter()
            .map(|tab| (tab.clone(), UBC_PROFILE.to_owned(), true))
            .collect::<Vec<_>>()
    );
}

// ---------------------------------------------------------------------------------------
// Viewports

#[test]
fn test_ready_primary_viewport_never_selects_a_tab_or_resizes_a_window() {
    setup();
    let host = FakeHost::new(|call| {
        assert!(call.runs(scripts::EXECUTE_TAB));
        assert_eq!(arguments(call), strings(&["42", scripts::VIEWPORT, "99"]));
        ok("{\"width\":1526,\"height\":900}")
    });
    let bridge = bridge(&host);
    let mut runner = pinned(&bridge, "42", "99");
    runner.warm_viewport(1.0, true).unwrap();
    runner.warm_viewport(1.0, true).unwrap();
    assert!(runner.viewport_ready);
    assert_eq!(host.calls().len(), 2);
}

#[test]
fn test_worker_tab_scripts_run_while_brave_stays_in_the_background() {
    setup();
    for script in [
        scripts::ACTIVATE_TAB,
        scripts::RESTORE_ACTIVE_TAB,
        scripts::OPEN_WORKER_WINDOW,
        scripts::LIVE_WORKER_TABS,
        scripts::NAVIGATE_TAB,
        scripts::EXECUTE_TAB,
    ] {
        assert!(!script.contains("frontmost"));
        assert!(!script.contains("front window"));
        assert!(!script.contains("activate"));
        assert!(!script.contains("tell application \"System Events\""));
    }
}

#[test]
fn test_cold_background_viewport_stops_before_any_job_source() {
    setup();
    let host = FakeHost::new(|call| {
        if call.runs(scripts::EXECUTE_TAB) {
            assert_eq!(arguments(call), strings(&["42", scripts::VIEWPORT, "99"]));
            return ok("{\"width\":0,\"height\":0}");
        }
        assert!(call.runs(scripts::ACTIVATE_TAB));
        // The pinned Brave tab is no longer on Instagram.
        failed("execution error: Pinned Instagram tab changed site. (-2700)")
    });
    let bridge = bridge(&host);
    let mut runner = pinned(&bridge, "42", "99");
    let error = error_of(runner.run("start readonly request", 1.0));
    assert!(error.is_session());
    assert_eq!(
        error.to_string(),
        "A worker Instagram window left Instagram"
    );
    let calls = host.calls();
    assert_eq!(calls.len(), 2);
    assert!(calls[0].runs(scripts::EXECUTE_TAB) && calls[1].runs(scripts::ACTIVATE_TAB));
    assert!(!runner.viewport_ready);
}

#[test]
fn test_all_fifteen_cold_tabs_warm_by_exact_id_and_restore_prior_active_tab() {
    setup();
    let visual_ids: Vec<String> = (1..=15).rev().map(|tab| tab.to_string()).collect();
    // (active, warmed, selected visual indexes)
    let state = shared(("15".to_owned(), Vec::<String>::new(), Vec::<usize>::new()));
    let (seen, order) = (state.clone(), visual_ids.clone());
    let host = FakeHost::new(move |call| {
        let mut state = seen.lock().unwrap();
        let arguments = arguments(call);
        if call.runs(scripts::ACTIVATE_TAB) {
            assert_eq!(arguments[1], "99");
            assert_eq!(arguments[2], "0");
            let previous = state.0.clone();
            let tab_id = arguments[0].clone();
            state
                .2
                .push(order.iter().position(|id| *id == tab_id).unwrap() + 1);
            state.0 = tab_id.clone();
            state.1.push(tab_id);
            return ok(&previous);
        }
        if call.runs(scripts::EXECUTE_TAB) {
            assert_eq!(arguments[1], scripts::VIEWPORT);
            if !state.1.contains(&arguments[0]) {
                return ok("{\"width\":0,\"height\":0}");
            }
            assert_eq!(arguments[0], state.0);
            return ok("{\"width\":1592,\"height\":1300}");
        }
        assert!(call.runs(scripts::RESTORE_ACTIVE_TAB));
        assert_eq!(state.0, arguments[0]);
        state.0 = arguments[1].clone();
        ok("restored")
    });
    let bridge = bridge(&host);
    for tab_id in 1..=15 {
        let mut runner = pinned(&bridge, &tab_id.to_string(), "99");
        runner.warm_viewport(1.0, false).unwrap();
        assert!(runner.viewport_ready);
        assert_eq!(state.lock().unwrap().0, "15");
    }
    let state = state.lock().unwrap();
    assert_eq!(state.2, (1..=15).rev().collect::<Vec<_>>());
    let mut warmed = state.1.clone();
    warmed.sort();
    let mut expected = visual_ids;
    expected.sort();
    assert_eq!(warmed, expected);
}

#[test]
fn test_zero_viewport_is_warmed_before_any_job_source_runs() {
    setup();
    let state = shared(("1".to_owned(), false, Vec::<&'static str>::new())); // (active, ready, calls)
    let seen = state.clone();
    let host = FakeHost::new(move |call| {
        let mut state = seen.lock().unwrap();
        let arguments = arguments(call);
        if call.runs(scripts::ACTIVATE_TAB) {
            assert_eq!(arguments, strings(&["42", "99", "0"]));
            state.0 = "42".to_owned();
            state.1 = true;
            state.2.push("activate");
            return ok("1");
        }
        if call.runs(scripts::RESTORE_ACTIVE_TAB) {
            assert_eq!(arguments, strings(&["42", "1", "99"]));
            state.0 = "1".to_owned();
            state.2.push("restore");
            return ok("restored");
        }
        assert!(call.runs(scripts::EXECUTE_TAB));
        if arguments[1] == scripts::VIEWPORT {
            state.2.push("viewport");
            return ok(if state.1 {
                "{\"width\":1200,\"height\":900}"
            } else {
                "{\"width\":0,\"height\":0}"
            });
        }
        assert!(state.1);
        state.2.push("job");
        ok("settled")
    });
    let bridge = bridge(&host);
    let mut runner = pinned(&bridge, "42", "99");
    assert_eq!(
        runner.run("start readonly request", 1.0).unwrap(),
        "settled"
    );
    assert_eq!(runner.run("poll readonly request", 1.0).unwrap(), "settled");
    let state = state.lock().unwrap();
    assert_eq!(
        state.2,
        vec!["viewport", "activate", "viewport", "restore", "job", "job"]
    );
    assert_eq!(state.0, "1");
}

#[test]
fn test_primary_warm_widens_only_registered_narrow_window_and_restores_selection() {
    setup();
    let minimum = control().primary_minimum_viewport_width;
    for cached in [false, true] {
        for (primary, initial_width) in [(true, 717), (true, 1526), (false, 717)] {
            // (width of 99, width of 88, active, resized)
            let state = shared((initial_width, 640, "2".to_owned(), Vec::<String>::new()));
            let seen = state.clone();
            let host = FakeHost::new(move |call| {
                let mut state = seen.lock().unwrap();
                let arguments = arguments(call);
                if call.runs(scripts::ACTIVATE_TAB) {
                    assert_eq!(arguments[..2], strings(&["42", "99"]));
                    let requested: u32 = arguments[2].parse().unwrap();
                    assert_eq!(requested, if primary { minimum } else { 0 });
                    if state.0 < requested {
                        state.0 = requested;
                        state.3.push("99".to_owned());
                    }
                    state.2 = "42".to_owned();
                    return ok("2");
                }
                if call.runs(scripts::RESTORE_ACTIVE_TAB) {
                    assert_eq!(arguments, strings(&["42", "2", "99"]));
                    state.2 = "2".to_owned();
                    return ok("restored");
                }
                assert!(call.runs(scripts::EXECUTE_TAB));
                assert_eq!(arguments, strings(&["42", scripts::VIEWPORT, "99"]));
                ok(&json!({"width": state.0, "height": 1300}).to_string())
            });
            let bridge = bridge(&host);
            let mut runner = pinned(&bridge, "42", "99");
            runner.viewport_ready = cached;
            runner.warm_viewport(1.0, primary).unwrap();
            let state = state.lock().unwrap();
            assert_eq!(
                (state.0, state.1),
                (
                    if primary {
                        initial_width.max(minimum)
                    } else {
                        initial_width
                    },
                    640
                )
            );
            assert_eq!(
                state.3,
                if primary && initial_width < 1024 {
                    strings(&["99"])
                } else {
                    Vec::new()
                }
            );
            assert_eq!(state.2, "2");
            assert!(runner.viewport_ready);
        }
    }
}

#[test]
fn test_primary_warm_reports_desktop_readiness_when_browser_viewport_stays_narrow() {
    setup();
    let restored = shared(Vec::<Vec<String>>::new());
    let seen = restored.clone();
    let host = FakeHost::new(move |call| {
        if call.runs(scripts::ACTIVATE_TAB) {
            return ok("2");
        }
        if call.runs(scripts::RESTORE_ACTIVE_TAB) {
            seen.lock().unwrap().push(arguments(call));
            return ok("restored");
        }
        assert!(call.runs(scripts::EXECUTE_TAB));
        ok("{\"width\":717,\"height\":1300}")
    });
    let bridge = bridge(&host);
    let mut runner = pinned(&bridge, "42", "99");
    let error = error_of(runner.warm_viewport(0.2, true));
    assert!(error.is(SessionKind::PageUnavailable));
    assert!(error.to_string().contains("primary desktop viewport"));
    assert_eq!(*restored.lock().unwrap(), vec![strings(&["42", "2", "99"])]);
    assert!(!runner.viewport_ready);
}

#[test]
fn test_primary_preparation_refreshes_cached_viewport_before_control_reads_and_restores_selection()
{
    setup();
    for allow_account_switch in [true, false] {
        // (calls, active, viewport width)
        let state = shared((Vec::<String>::new(), "2".to_owned(), 717));
        let seen = state.clone();
        let host = FakeHost::new(move |call| {
            let mut state = seen.lock().unwrap();
            let arguments = arguments(call);
            if call.runs(scripts::ACTIVATE_TAB) {
                assert_eq!(arguments, strings(&["42", "99", "1024"]));
                state.0.push("activate".to_owned());
                state.1 = "42".to_owned();
                state.2 = 1526;
                return ok("2");
            }
            if call.runs(scripts::RESTORE_ACTIVE_TAB) {
                assert_eq!(arguments, strings(&["42", "2", "99"]));
                assert_eq!(state.1, "42");
                state.0.push("restore".to_owned());
                state.1 = "2".to_owned();
                return ok("restored");
            }
            assert!(call.runs(scripts::EXECUTE_TAB));
            let source = arguments[1].as_str();
            if source == scripts::VIEWPORT {
                state.0.push("viewport".to_owned());
                return ok(&json!({"width": state.2, "height": 1300}).to_string());
            }
            if source == scripts::CANCEL_REQUEST {
                state.0.push("cancel".to_owned());
                return ok("settled");
            }
            if source == scripts::CLEAR_REQUEST {
                state.0.push("clear".to_owned());
                return ok("cleared");
            }
            // The account controls: read with the tab's selection restored.
            assert_eq!(state.1, "2");
            let width = state.2;
            state.0.push(format!("controls at {width}"));
            if source == scripts::CURRENT_ACCOUNT_USERNAME {
                return ok("wat2do.uwaterloo");
            }
            if source == scripts::recipient_is_active("41553815702") {
                return ok("true");
            }
            assert_eq!(source, scripts::ACCOUNT_CHOOSER_STATE);
            ok("pending")
        });
        let bridge = bridge(&host);
        let mut tab = pinned(&bridge, "42", "99");
        tab.viewport_ready = true;
        let mut session =
            BrowserInstagramSession::new(bridge, Box::new(tab), allow_account_switch, None);
        assert_eq!(
            session
                .activate_account("41553815702", "wat2do.uwaterloo")
                .unwrap(),
            "wat2do.uwaterloo"
        );
        let calls = state.lock().unwrap().0.clone();
        let first_control = calls
            .iter()
            .position(|call| call.starts_with("controls"))
            .unwrap();
        assert_eq!(
            calls[..=first_control],
            if allow_account_switch {
                strings(&[
                    "cancel",
                    "clear",
                    "viewport",
                    "activate",
                    "viewport",
                    "restore",
                    "controls at 1526",
                ])
            } else {
                strings(&["cancel", "clear", "controls at 717"])
            }
        );
    }
}

#[test]
fn test_fourteen_navigation_reads_progress_while_cold_viewport_waits() {
    setup();
    for cold_state in ["zero", "loading", "timeout"] {
        let cold_waiting = Arc::new(Event::default());
        let healthy_done = Arc::new(Event::default());
        // (healthy count, activations, restores)
        let state = shared((0usize, 0usize, Vec::<Vec<String>>::new()));
        let (seen, done) = (state.clone(), healthy_done.clone());
        let host = FakeHost::new(move |call| {
            let mut state = seen.lock().unwrap();
            let supplied = arguments(call);
            if call.runs(scripts::NAVIGATE_TAB) {
                return ok("navigating");
            }
            if call.runs(scripts::ACTIVATE_TAB) {
                assert_eq!(supplied, strings(&["14", "99", "0"]));
                state.1 += 1;
                return ok("1");
            }
            if call.runs(scripts::RESTORE_ACTIVE_TAB) {
                state.2.push(supplied);
                return ok("restored");
            }
            assert!(call.runs(scripts::EXECUTE_TAB));
            let (tab_id, source) = (supplied[0].as_str(), supplied[1].as_str());
            if source == scripts::VIEWPORT {
                if tab_id == "14" && state.1 == 0 && cold_state == "timeout" {
                    return timed_out();
                }
                if tab_id == "14" && state.1 == 1 && cold_state == "loading" {
                    return failed("Pinned Instagram tab is loading.");
                }
                return ok(if tab_id == "14" && state.1 < 2 {
                    "{\"width\":0,\"height\":0}"
                } else {
                    "{\"width\":1592,\"height\":1300}"
                });
            }
            if tab_id != "14" {
                state.0 += 1;
                if state.0 == 13 {
                    done.set();
                }
            }
            ok("ready")
        });
        let (waiting, done) = (cold_waiting.clone(), healthy_done.clone());
        // The cold tab must restore selection and release the one transport before
        // waiting. Otherwise the other thirteen jobs cannot progress.
        let bridge = hooked_bridge(&host, move |_| {
            waiting.set();
            assert!(
                done.wait(2.0),
                "Viewport waits starved healthy tab operations"
            );
        });
        let retrieve = |tab_id: usize| {
            let bridge = bridge.clone();
            spawn(move || {
                let mut runner = pinned(&bridge, &tab_id.to_string(), "99");
                runner
                    .navigate(
                        &format!("https://www.instagram.com/p/POST{tab_id}/"),
                        3.0,
                        false,
                    )
                    .unwrap()
                    .unwrap();
                runner.run("read exact target", 3.0)
            })
        };
        let cold = retrieve(14);
        assert!(cold_waiting.wait(2.0));
        let healthy: Vec<_> = (1..14).map(retrieve).collect();
        let healthy: Vec<String> = healthy
            .into_iter()
            .map(|worker| worker.join().unwrap().unwrap())
            .collect();
        assert_eq!(healthy, vec!["ready".to_owned(); 13]);
        assert_eq!(cold.join().unwrap().unwrap(), "ready");
        let state = state.lock().unwrap();
        assert_eq!(state.1, 2, "{cold_state}");
        assert_eq!(state.2, vec![strings(&["14", "1", "99"]); 2]);
    }
}

#[test]
fn test_viewport_probe_skips_native_loading_wait_but_business_source_keeps_it() {
    setup();
    assert!(scripts::EXECUTE_TAB.contains(&format!(
        "if javascriptSource is not {} and loading of browserTab",
        pyjson::string(scripts::VIEWPORT)
    )));
}

#[test]
fn test_unresponsive_initial_viewport_probe_has_short_budget_and_native_recovery() {
    setup();
    let host = FakeHost::new(move |call| {
        if call.runs(scripts::ACTIVATE_TAB) {
            return ok("1");
        }
        if call.runs(scripts::RESTORE_ACTIVE_TAB) {
            return ok("restored");
        }
        assert!(call.runs(scripts::EXECUTE_TAB));
        ok(if call.javascript() == Some(scripts::VIEWPORT) {
            "{\"width\":1592,\"height\":1300}"
        } else {
            "ready"
        })
    });
    let first = Arc::new(Mutex::new(true));
    let probe = host.clone();
    let wrapped = FakeHost::new(move |call| {
        let mut first = first.lock().unwrap();
        if *first {
            *first = false;
            assert!(call.runs(scripts::EXECUTE_TAB));
            assert!(0.0 < call.timeout && call.timeout <= control().viewport_warm_timeout_seconds);
            return timed_out();
        }
        drop(first);
        probe.run(
            &call.program,
            &call.args,
            call.stdin.as_deref(),
            call.timeout,
        )
    });
    let bridge = bridge(&wrapped);
    let mut runner = pinned(&bridge, "42", "99");
    assert_eq!(runner.run("read exact target", 30.0).unwrap(), "ready");
    let order: Vec<&str> = wrapped
        .calls()
        .iter()
        .map(|call| {
            [
                scripts::EXECUTE_TAB,
                scripts::ACTIVATE_TAB,
                scripts::RESTORE_ACTIVE_TAB,
            ]
            .into_iter()
            .find(|script| call.runs(script))
            .unwrap()
        })
        .collect();
    assert_eq!(
        order,
        vec![
            scripts::EXECUTE_TAB,
            scripts::ACTIVATE_TAB,
            scripts::EXECUTE_TAB,
            scripts::RESTORE_ACTIVE_TAB,
            scripts::EXECUTE_TAB,
        ]
    );
}

// ---------------------------------------------------------------------------------------
// Retiring and settling tabs

#[test]
fn test_primary_tab_cannot_be_retired_even_when_unresponsive() {
    setup();
    let host = FakeHost::idle();
    let bridge = bridge(&host);
    let tab = pinned(&bridge, "1", "99");
    let error = error_of(
        BrowserInstagramSession::new(bridge, Box::new(tab), true, None)
            .retire_unresponsive_read_tab(),
    );
    assert!(error.is_session() && error.to_string().contains("Only a pinned secondary"));
    assert!(host.calls().is_empty(), "Never close primary");
}

#[test]
fn test_secondary_retirement_closes_exact_document_and_proves_global_absence() {
    setup();
    let host = FakeHost::new(|call| {
        if call.runs(scripts::CLOSE_WORKER_TAB) {
            return ok("closed");
        }
        assert!(call.runs(scripts::WORKER_WINDOW));
        failed("execution error: Pinned Instagram tab is closed. (-2700)")
    });
    let bridge = bridge(&host);
    let tab = pinned(&bridge, "42", "99");
    BrowserInstagramSession::new(bridge, Box::new(tab), false, None)
        .retire_unresponsive_read_tab()
        .unwrap();
    let calls = host.calls();
    assert_eq!(calls.len(), 2);
    assert!(calls[0].runs(scripts::CLOSE_WORKER_TAB));
    assert_eq!(arguments(&calls[0]), strings(&["42", "99"]));
    assert!(calls[1].runs(scripts::WORKER_WINDOW));
    assert_eq!(arguments(&calls[1]), strings(&["42"]));
}

#[test]
fn test_pool_settlement_drains_every_tab_and_only_retires_secondaries() {
    setup();
    for failing_index in [0, 1] {
        let failing_tab = (failing_index + 1).to_string();
        let mut page = logged_in_page(|_| "wat2do.ubc".to_owned());
        let pool = registered_pool(3, UBC_PROFILE, move |brave, tab, source| {
            if source == scripts::CANCEL_REQUEST && tab == failing_tab {
                // Its cancellation is never confirmed.
                return ok("pending");
            }
            page(brave, tab, source)
        });
        let error = error_of(pool.pool.settle_registered_tabs());
        if failing_index == 1 {
            assert!(error.is(SessionKind::TabUnavailable), "{error:?}");
        } else {
            assert!(error.is(SessionKind::Session), "{error:?}");
            assert!(
                error
                    .to_string()
                    .contains("cancellation could not be confirmed")
            );
        }
        let brave = pool.brave.lock().unwrap();
        assert_eq!(
            tabs_running(&brave, |source| source == scripts::CANCEL_REQUEST),
            strings(&["1", "2", "3"])
        );
        assert_eq!(
            brave.closed,
            if failing_index == 1 {
                strings(&["2"])
            } else {
                Vec::new()
            }
        );
    }
}

#[test]
fn test_native_navigation_preserves_actionable_recovery_failure() {
    setup();
    let host =
        FakeHost::new(|_| failed("Instagram requires human account recovery. private page text"));
    let bridge = bridge(&host);
    let tab = pinned(&bridge, "42", "99");
    let mut session = BrowserInstagramSession::new(bridge, Box::new(tab), true, None);
    let error = error_of(session.navigate("https://www.instagram.com/wat2do.ubc/", false));
    assert!(error.is_session() && error.to_string().contains("human account recovery"));
    assert!(!error.to_string().contains("private"));
}

// ---------------------------------------------------------------------------------------
// Worker windows

/// The `brave_pool` fixture: `tabs` configured tabs, `registered` worker tabs, and pages
/// that show `wat2do.ubc`.
fn brave_pool(
    windows: Vec<(String, Vec<(String, String)>)>,
    tabs: usize,
    registered: &[&str],
) -> Pool {
    overrides::instagram_browser(|control| {
        control.parallel_tabs = tabs;
        control.navigation_interval_seconds = 0.0;
    });
    let pool = Pool::new(
        windows,
        &strings(registered),
        logged_in_page(|_| "wat2do.ubc".to_owned()),
    );
    pool.set("retrieval_pool_account", json!("wat2do.ubc"));
    pool
}

#[test]
fn test_pool_opens_its_own_popup_windows_and_never_adopts_a_persons_tab() {
    setup();
    let pool = brave_pool(
        one_tab_windows(&[("10", "500", "https://www.instagram.com/")]),
        2,
        &[],
    );
    let ids = pool.pool.ensure_capacity(None).unwrap();
    assert_eq!(ids.len(), 2);
    assert!(!ids.contains(&"500".to_owned()));
    assert_eq!(pool.setting("browser_tab_ids"), json!(ids));
    {
        let brave = pool.brave.lock().unwrap();
        // The first window comes from a blank bootstrap; later ones from the primary.
        assert_eq!(brave.opened, vec![String::new(), ids[0].clone()]);
        for tab in &ids {
            let (window, _) = brave.find(tab).unwrap();
            let (_, tabs) = brave.windows.iter().find(|(id, _)| *id == window).unwrap();
            assert_eq!(tabs.len(), 1);
        }
    }
    assert_eq!(pool.pool.ensure_capacity(None).unwrap(), ids);
    assert_eq!(pool.brave.lock().unwrap().opened.len(), 2);
}

#[test]
fn test_pool_replaces_closed_and_browsed_away_windows_without_pausing() {
    setup();
    let pool = brave_pool(
        one_tab_windows(&[("20", "1", UBC_PROFILE), ("30", "2", UBC_PROFILE)]),
        2,
        &["1", "2"],
    );
    pool.brave.lock().unwrap().remove_window("30");
    let first = pool.pool.ensure_capacity(None).unwrap();
    assert_eq!(first[0], "1");
    assert_ne!(first[1], "2");
    assert_eq!(pool.brave.lock().unwrap().opened, strings(&["1"]));
    pool.brave
        .lock()
        .unwrap()
        .set_url(&first[1], "https://example.com/reading");
    let second = pool.pool.ensure_capacity(None).unwrap();
    assert_eq!(second[0], "1");
    assert!(!first.contains(&second[1]));
    // A window someone browsed elsewhere is left open for them.
    let brave = pool.brave.lock().unwrap();
    assert!(brave.closed.is_empty() && brave.find(&first[1]).is_some());
    drop(brave);
    assert_eq!(pool.setting("retrieval_pool_account"), json!("wat2do.ubc"));
}

#[test]
fn test_lost_primary_is_replaced_first_without_promoting_a_retrieval_tab() {
    setup();
    let pool = brave_pool(
        one_tab_windows(&[("30", "2", UBC_PROFILE), ("40", "3", UBC_PROFILE)]),
        3,
        &["1", "2", "3"],
    );
    let ids = pool.pool.ensure_capacity(None).unwrap();
    assert_eq!(ids[1..], strings(&["2", "3"]));
    assert!(!["1", "2", "3"].contains(&ids[0].as_str()));
    assert_eq!(pool.brave.lock().unwrap().opened, strings(&["2"]));
    assert_eq!(pool.setting("retrieval_pool_account"), Value::Null);
}

#[test]
fn test_pool_closes_surplus_owned_windows_and_leaves_other_tabs_alone() {
    setup();
    let owned: Vec<String> = (1..=20).map(|tab| tab.to_string()).collect();
    let mut windows: Vec<(String, Vec<(String, String)>)> = owned
        .iter()
        .map(|tab| {
            (
                (100 + tab.parse::<u64>().unwrap()).to_string(),
                vec![(tab.clone(), UBC_PROFILE.to_owned())],
            )
        })
        .collect();
    windows.push((
        "9999".to_owned(),
        vec![("999".to_owned(), "https://www.instagram.com/".to_owned())],
    ));
    let registered: Vec<&str> = owned.iter().map(String::as_str).collect();
    let pool = brave_pool(windows, 7, &registered);
    assert_eq!(pool.pool.ensure_capacity(None).unwrap(), owned[..7]);
    let brave = pool.brave.lock().unwrap();
    assert_eq!(brave.closed, owned[7..]);
    assert!(brave.find("999").is_some() && brave.opened.is_empty());
}

#[test]
fn test_window_creation_shares_page_load_spacing_with_navigation() {
    setup();
    overrides::instagram_browser(|control| control.navigation_interval_seconds = 1.0);
    let sent = shared(Vec::<(String, f64)>::new());
    let clock: Shared<Option<Arc<FakeHost>>> = shared(None);
    let (record, host_clock) = (sent.clone(), clock.clone());
    let host = FakeHost::new(move |call| {
        if call.program == IOREG {
            return ok("\"HIDIdleTime\" = 99000000000\n");
        }
        if call.runs(scripts::FRONT_APPLICATION) {
            return ok("700");
        }
        let now = host_clock.lock().unwrap().as_ref().unwrap().monotonic();
        let mut sent = record.lock().unwrap();
        if call.runs(scripts::OPEN_WORKER_WINDOW) {
            sent.push(("open".to_owned(), now));
            return ok(&(sent.len() + 1).to_string());
        }
        assert!(call.runs(scripts::NAVIGATE_TAB));
        sent.push(("navigate".to_owned(), now));
        ok("navigating")
    });
    *clock.lock().unwrap() = Some(host.clone());
    let start = host.monotonic();
    let bridge = bridge(&host);
    let directory = tempfile::tempdir().unwrap();
    let pool = BrowserTabPool::new(bridge.clone(), queue(directory.path(), &host));
    let profile = "https://www.instagram.com/wat2do.uwaterloo/";
    let mut runner = pinned(&bridge, "1", "99");
    assert_eq!(
        runner.navigate(profile, 3.0, false).unwrap().unwrap(),
        "navigating"
    );
    for _ in 0..3 {
        pool.open_window(Some("1"), profile).unwrap();
    }
    assert_eq!(
        runner
            .navigate("https://www.instagram.com/p/POST/", 3.0, false)
            .unwrap()
            .unwrap(),
        "navigating"
    );
    *clock.lock().unwrap() = None;
    let sent: Vec<(String, f64)> = sent
        .lock()
        .unwrap()
        .iter()
        .map(|(kind, at)| (kind.clone(), at - start))
        .collect();
    assert_eq!(
        sent,
        vec![
            ("navigate".to_owned(), 0.0),
            ("open".to_owned(), 1.0),
            ("open".to_owned(), 2.0),
            ("open".to_owned(), 3.0),
            ("navigate".to_owned(), 4.0),
        ]
    );
}

#[test]
fn test_uncertain_window_opening_is_never_replayed() {
    setup();
    overrides::instagram_browser(|control| control.parallel_tabs = 2);
    let opens = shared(0usize);
    let seen = opens.clone();
    let brave = shared(Brave::new(Vec::new()));
    let inner = brave_host(brave, logged_in_page(|_| "wat2do.ubc".to_owned()));
    let host = FakeHost::new(move |call| {
        if call.runs(scripts::OPEN_WORKER_WINDOW) {
            *seen.lock().unwrap() += 1;
            return timed_out();
        }
        inner.run(
            &call.program,
            &call.args,
            call.stdin.as_deref(),
            call.timeout,
        )
    });
    let directory = tempfile::tempdir().unwrap();
    let queue = queue(directory.path(), &host);
    queue.set_setting("browser_tab_ids", json!([])).unwrap();
    queue
        .set_setting("retrieval_pool_account", json!("wat2do.ubc"))
        .unwrap();
    let pool = BrowserTabPool::new(bridge(&host), queue.clone());
    let error = error_of(pool.ensure_capacity(None));
    assert!(error.is(SessionKind::AutomationTransient));
    assert_eq!(*opens.lock().unwrap(), 1);
    assert_eq!(
        queue.get_setting("browser_tab_ids").unwrap(),
        Some(json!([]))
    );
}

/// Every call but tab page sources, as `(script, arguments)`.
fn native_calls(host: &FakeHost) -> Vec<(&'static str, Vec<String>)> {
    host.calls()
        .iter()
        .filter(|call| !call.runs(scripts::EXECUTE_TAB))
        .map(|call| {
            let script = [
                scripts::WORKER_WINDOW,
                scripts::CLOSE_WORKER_TAB,
                scripts::LIVE_WORKER_TABS,
            ]
            .into_iter()
            .find(|script| call.runs(script))
            .unwrap_or("other");
            (script, arguments(call))
        })
        .collect()
}

#[test]
fn test_surplus_window_timeout_closes_exact_document_and_verifies_absence() {
    setup();
    let mut page = logged_in_page(|_| "wat2do.ubc".to_owned());
    let pool = Pool::new(
        one_tab_windows(&[("99", "42", UBC_PROFILE)]),
        &[],
        move |brave, tab, source| {
            if source == scripts::CANCEL_REQUEST {
                // Its cancellation cannot be confirmed: Brave times out.
                return timed_out();
            }
            page(brave, tab, source)
        },
    );
    pool.pool.close_settled_tab("42").unwrap();
    assert_eq!(
        native_calls(&pool.host),
        vec![
            (scripts::WORKER_WINDOW, strings(&["42"])),
            (scripts::CLOSE_WORKER_TAB, strings(&["42", "99"])),
            (scripts::WORKER_WINDOW, strings(&["42"])),
        ]
    );
}

#[test]
fn test_surplus_window_closure_requires_verified_absence() {
    setup();
    let host = FakeHost::new(|call| {
        if call.runs(scripts::CLOSE_WORKER_TAB) {
            return ok("closed");
        }
        if call.runs(scripts::WORKER_WINDOW) {
            return ok("99");
        }
        match call.javascript() {
            Some(source) if source == scripts::VIEWPORT => ok("{\"width\":1300,\"height\":900}"),
            Some(source) if source == scripts::CANCEL_REQUEST => ok("settled"),
            Some(source) if source == scripts::CLEAR_REQUEST => ok("cleared"),
            _ => panic!("unexpected call {call:?}"),
        }
    });
    let directory = tempfile::tempdir().unwrap();
    let pool = BrowserTabPool::new(bridge(&host), queue(directory.path(), &host));
    let error = error_of(pool.close_settled_tab("42"));
    assert!(error.is_session() && error.to_string().contains("closure could not be confirmed"));
}

#[test]
fn test_already_closed_surplus_window_needs_no_closing() {
    setup();
    let host = FakeHost::new(|call| {
        assert!(call.runs(scripts::WORKER_WINDOW));
        failed("execution error: Pinned Instagram tab is closed. (-2700)")
    });
    let directory = tempfile::tempdir().unwrap();
    let pool = BrowserTabPool::new(bridge(&host), queue(directory.path(), &host));
    pool.close_settled_tab("42").unwrap();
}

// ---------------------------------------------------------------------------------------
// Login recovery

/// `_login_pool`: a pool whose primary window shows `pages` in turn; records its runs
/// (clicks) and the other window's reloads.
fn login_pool(
    pages: Vec<Value>,
    preferred: Value,
    passwords: &[(&str, &str)],
) -> (Pool, Shared<Vec<String>>) {
    let clicks = shared(Vec::<String>::new());
    let seen = clicks.clone();
    let mut pages = pages.into_iter();
    let mut current = Value::Null;
    let pool = registered_pool(2, UBC_PROFILE, move |brave, tab, source| {
        if tab == "2" {
            assert_eq!(source, scripts::RELOAD);
            return ok("1");
        }
        if source == scripts::LOGIN_PAGE {
            if let Some(page) = pages.next() {
                current = page;
            }
            return ok(&current.to_string());
        }
        let submitted = !brave.secrets.is_empty();
        if source == scripts::LOGIN_FORM_STATE {
            return ok(&json!({"state": if submitted { "pending" } else { "form" }}).to_string());
        }
        if source == scripts::CURRENT_ACCOUNT_USERNAME {
            // A password login ends on the account it logged in.
            return ok(if submitted {
                "wat2do.tmu"
            } else {
                "wat2do.ottawa"
            });
        }
        seen.lock().unwrap().push(source.to_owned());
        ok("clicked")
    });
    pool.set("retrieval_pool_account", preferred);
    pool.brave.lock().unwrap().passwords = passwords
        .iter()
        .map(|(account, password)| ((*account).to_owned(), (*password).to_owned()))
        .collect();
    (pool, clicks)
}

fn reloads(pool: &Pool) -> Vec<(String, String)> {
    pool.brave
        .lock()
        .unwrap()
        .sources
        .iter()
        .filter(|(tab, _)| tab == "2")
        .cloned()
        .collect()
}

#[test]
fn test_login_recovery_clicks_the_saved_profile_and_keeps_one_tap_login() {
    setup();
    let profiles = json!([
        "about",
        "remove profiles from this browser",
        "wat2do.ubc",
        "wat2do.ottawa"
    ]);
    let (pool, clicks) = login_pool(
        vec![
            json!({"state": "loading"}),
            json!({"state": "profiles", "profiles": profiles}),
            json!({"state": "profiles", "profiles": profiles}),
            json!({"state": "save_info"}),
        ],
        json!("wat2do.ottawa"),
        &[],
    );
    assert_eq!(pool.pool.recover_login().unwrap(), "wat2do.ottawa");
    let clicks = clicks.lock().unwrap();
    assert!(clicks[0].contains("window.location.assign"));
    // The previously active account is preferred, clicked once, then login info is saved.
    assert_eq!(
        clicks[1..],
        [
            scripts::click_label("wat2do.ottawa"),
            scripts::SAVE_LOGIN.to_owned(),
        ]
    );
    // Account identity is re-verified before the next job.
    assert_eq!(pool.setting("retrieval_pool_account"), Value::Null);
    // The other worker window drops its stale logged-out page.
    assert_eq!(
        reloads(&pool),
        vec![("2".to_owned(), "window.location.reload(); 1".to_owned())]
    );
}

#[test]
fn test_login_recovery_falls_back_to_any_saved_wat2do_profile() {
    setup();
    let (pool, clicks) = login_pool(
        vec![
            json!({"state": "profiles", "profiles": ["help", "wat2do.ubc"]}),
            json!({"state": "logged_in"}),
        ],
        Value::Null,
        &[],
    );
    assert_eq!(pool.pool.recover_login().unwrap(), "wat2do.ottawa");
    assert_eq!(
        clicks.lock().unwrap()[1..],
        [scripts::click_label("wat2do.ubc")]
    );
}

#[test]
fn test_login_recovery_stops_for_a_person_at_a_challenge() {
    setup();
    let (pool, _) = login_pool(
        vec![
            json!({"state": "profiles", "profiles": ["wat2do.ottawa"]}),
            json!({"state": "challenge"}),
        ],
        json!("wat2do.ottawa"),
        &[],
    );
    let error = error_of(pool.pool.recover_login());
    assert!(error.is_session() && error.to_string().contains("asks to confirm the account"));
    // This pause is not the logged-out one, so recovery is not attempted again.
    assert!(
        !error
            .to_string()
            .starts_with("Instagram browser requires human account recovery")
    );
}

#[test]
fn test_login_recovery_answers_a_password_prompt_for_the_clicked_profile() {
    setup();
    let (pool, _) = login_pool(
        vec![
            json!({"state": "profiles", "profiles": ["tmu.wat2do.io"]}),
            json!({"state": "password"}),
        ],
        json!("wat2do.ottawa"),
        &[("wat2do.tmu", "fixture-password")],
    );
    // The real log_in runs; its page ends on the account it logged in.
    assert_eq!(pool.pool.recover_login().unwrap(), "wat2do.tmu");
    let brave = pool.brave.lock().unwrap();
    assert_eq!(brave.keychain_asked, strings(&["wat2do.tmu"]));
    assert_eq!(brave.secrets.len(), 1);
    assert!(brave.secrets[0].contains("wat2do.tmu"));
    drop(brave);
    // The password entry is recorded: the account cannot get another one today.
    assert!(pool.setting("account_login_at:wat2do.tmu").is_number());
    assert!(
        !pool
            .queue
            .reserve_account_login("wat2do.tmu", pool.host.time())
            .unwrap()
    );
}

#[test]
fn test_login_recovery_refuses_a_second_password_entry_the_same_day() {
    setup();
    let (pool, _) = login_pool(
        vec![
            json!({"state": "profiles", "profiles": ["tmu.wat2do.io"]}),
            json!({"state": "password"}),
        ],
        json!("wat2do.ottawa"),
        &[("wat2do.tmu", "fixture-password")],
    );
    // An earlier recovery today already typed this account's password.
    assert!(
        pool.queue
            .reserve_account_login("wat2do.tmu", pool.host.time() - 3600.0)
            .unwrap()
    );
    let error = error_of(pool.pool.recover_login());
    assert!(error.is_session());
    assert!(
        error
            .to_string()
            .contains("password was already entered today")
    );
    assert!(pool.brave.lock().unwrap().secrets.is_empty());
}

#[test]
fn test_login_recovery_without_a_stored_password_stops_for_a_person() {
    setup();
    let (pool, _) = login_pool(
        vec![
            json!({"state": "profiles", "profiles": ["wat2do.ottawa"]}),
            json!({"state": "password"}),
        ],
        json!("wat2do.ottawa"),
        &[],
    );
    let error = error_of(pool.pool.recover_login());
    assert!(error.is_session());
    assert!(
        error
            .to_string()
            .contains("no stored password for wat2do.ottawa")
    );
}

#[test]
fn test_click_label_source_only_clicks_one_exact_match() {
    setup();
    let source = scripts::click_label("Save info");
    assert!(source.contains("\"save info\"") && source.contains("matches.length !== 1"));
}

#[test]
fn test_a_job_asks_instagrams_server_before_trusting_a_logged_in_page() {
    setup();
    // A page can still look logged in after Instagram logs the browser out.
    let mut page = logged_in_page(|_| "wat2do.ubc".to_owned());
    let pool = registered_pool(2, UBC_PROFILE, move |brave, tab, source| {
        if source == scripts::SERVER_LOGIN {
            return ok("logged_out");
        }
        page(brave, tab, source)
    });
    let error = error_of(pool.pool.prepare(&job("digest", "123", "wat2do.ubc"), 1));
    assert!(error.is_session());
    assert_eq!(error.to_string(), LOGGED_OUT_PAUSE);
    let brave = pool.brave.lock().unwrap();
    let after_settling: Vec<&String> = brave
        .sources
        .iter()
        .skip_while(|(_, source)| source != scripts::SERVER_LOGIN)
        .map(|(_, source)| source)
        .collect();
    assert_eq!(after_settling, vec![scripts::SERVER_LOGIN]);
    assert!(scripts::SERVER_LOGIN.contains("/accounts/edit/"));
    assert!(!scripts::SERVER_LOGIN.to_lowercase().contains("cookie"));
}

#[test]
fn test_an_unconfirmed_cancellation_pauses_only_requests_that_can_change_something() {
    setup();
    // A primary-tab read that cannot be cancelled is dropped; an action still needs a person.
    for read_only in [true, false] {
        let host = FakeHost::idle();
        let clock = host.clone();
        let mut started = false;
        let fake = runner(move |source, _| {
            if source == "start request" {
                started = true;
                return Ok("started".to_owned());
            }
            if source == scripts::CLEAR_REQUEST {
                return Ok("cleared".to_owned());
            }
            if source == scripts::CANCEL_REQUEST && !started {
                return Ok("settled".to_owned());
            }
            if source == scripts::REQUEST_STATE || source == scripts::CANCEL_REQUEST {
                // The page stops answering once the request is in flight.
                clock.advance(1000.0);
                return Err(BrowserError::transient(TIMED_OUT));
            }
            panic!("{source}");
        });
        let error = error_of(session(&host, fake).query("start request", read_only));
        assert_eq!(
            error
                .to_string()
                .contains("cancellation could not be confirmed"),
            !read_only
        );
    }
}

#[test]
fn test_login_sources_parse() {
    setup();
    for source in [
        scripts::submit_login("wat2do.ucalgary", "pa\"ss\\word"),
        scripts::submit_code("123456"),
        scripts::LOGIN_FORM_STATE.to_owned(),
    ] {
        let Some((success, _, stderr)) = node(&["--check"], &source) else {
            return;
        };
        assert!(success, "{stderr}");
    }
}

#[test]
fn test_a_password_reaches_brave_on_stdin_never_the_command_line() {
    setup();
    let host = FakeHost::new(|_| ok("submitted"));
    let bridge = bridge(&host);
    let mut runner = pinned(&bridge, "7", "99");
    let source = scripts::submit_login("wat2do.ucalgary", "s3cret");
    assert_eq!(runner.run_secret(&source, 3.0).unwrap(), "submitted");
    let call = host.calls().pop().unwrap();
    assert_eq!(call.program, OSASCRIPT);
    assert_eq!(call.args, strings(&["-", "7", "", "99"]));
    assert!(!call.args.iter().any(|argument| argument.contains("s3cret")));
    let script = call.stdin.unwrap();
    assert!(script.contains("s3cret") && !script.contains("item 2 of argv"));
}

/// `_LoginRunner`: Instagram's login screens on tab 7, the form and then each state in
/// turn after submit.
struct LoginPage {
    states: Vec<String>,
    account: String,
    submitted: Vec<String>,
    clicked: Vec<String>,
    stalls: usize,
}

fn login_session(
    states: &[&str],
    codes: Vec<Option<String>>,
) -> (Shared<LoginPage>, BrowserInstagramSession) {
    login_session_with(states, codes, LoginFault::None, Some(30.0))
}

/// What goes wrong once the password is typed.
#[derive(Clone, Copy, PartialEq)]
enum LoginFault {
    None,
    /// The Apple Event carrying the password fails.
    SecretFails,
    /// The page stops answering after the password was submitted.
    PageStops,
    /// The one-tap prompt's Save button has not rendered on the first click.
    SaveButtonLate,
    /// Brave stalls the first two Apple Events after the password was submitted.
    BraveStallsTwice,
}

fn login_session_with(
    states: &[&str],
    codes: Vec<Option<String>>,
    fault: LoginFault,
    job_timeout: Option<f64>,
) -> (Shared<LoginPage>, BrowserInstagramSession) {
    let page = shared(LoginPage {
        states: strings(states),
        account: "wat2do.guelph".to_owned(),
        submitted: Vec::new(),
        clicked: Vec::new(),
        stalls: 0,
    });
    let seen = page.clone();
    let host = FakeHost::new(move |call| {
        let mut page = seen.lock().unwrap();
        if call.program == SECURITY {
            // The Gmail inbox's IMAP password.
            return ok("imap-fixture\n");
        }
        if let Some(script) = &call.stdin {
            page.submitted.push(script.clone());
            if fault == LoginFault::SecretFails {
                return failed("execution error: Brave got an error: (-1712)");
            }
            return ok("submitted\n");
        }
        if fault == LoginFault::PageStops && !page.submitted.is_empty() {
            return timed_out();
        }
        if fault == LoginFault::BraveStallsTwice && !page.submitted.is_empty() && page.stalls < 2 {
            page.stalls += 1;
            return timed_out();
        }
        let source = call.javascript().expect("a tab source");
        if source == scripts::VIEWPORT {
            return ok("{\"width\":1300,\"height\":900}");
        }
        if source == scripts::LOGIN_FORM_STATE {
            let mut state = if page.submitted.is_empty() {
                "form".to_owned()
            } else {
                page.states[0].clone()
            };
            if !page.submitted.is_empty() && page.states.len() > 1 {
                page.states.remove(0);
            }
            if state == "done" {
                page.account = "wat2do.ucalgary".to_owned();
                state = "pending".to_owned();
            }
            return ok(&json!({"state": state}).to_string());
        }
        if source == scripts::CURRENT_ACCOUNT_USERNAME {
            return ok(&page.account);
        }
        page.clicked.push(source.to_owned());
        if fault == LoginFault::SaveButtonLate
            && source == scripts::SAVE_LOGIN
            && page
                .clicked
                .iter()
                .filter(|clicked| **clicked == source)
                .count()
                == 1
        {
            return ok("missing");
        }
        ok(if source.contains("verificationCode") {
            "submitted"
        } else {
            "clicked"
        })
    });
    let mailbox = Arc::new(FakeMailbox::default());
    *mailbox.codes.lock().unwrap() = codes;
    let bridge = super::super::test_support::bridge_with_mailbox(&host, mailbox);
    let tab = pinned(&bridge, "7", "99");
    (
        page,
        BrowserInstagramSession::new(bridge, Box::new(tab), true, job_timeout),
    )
}

#[test]
fn test_log_in_saves_the_login_info_and_ends_on_the_account() {
    setup();
    let (page, mut session) = login_session(&["pending", "save_info", "done"], Vec::new());
    session.log_in("wat2do.ucalgary", "s3cret").unwrap();
    let page = page.lock().unwrap();
    assert_eq!(page.submitted.len(), 1);
    assert!(
        page.clicked
            .iter()
            .any(|source| source == scripts::SAVE_LOGIN)
    );
}

#[test]
fn test_log_in_enters_the_emailed_code() {
    setup();
    let (page, mut session) = login_session(
        &["code", "pending", "done"],
        vec![Some("654321".to_owned())],
    );
    session.log_in("wat2do.ucalgary", "s3cret").unwrap();
    assert!(
        page.lock()
            .unwrap()
            .clicked
            .contains(&scripts::submit_code("654321"))
    );
}

#[test]
fn test_log_in_stops_for_a_person_on_a_refused_password_or_challenge() {
    setup();
    for (state, message) in [
        ("wrong_password", "refused wat2do.ucalgary's password"),
        ("challenge", "confirm"),
    ] {
        let (page, mut session) = login_session(&[state], Vec::new());
        let error = error_of(session.log_in("wat2do.ucalgary", "s3cret"));
        assert!(error.is(SessionKind::LoginSubmitted), "{error:?}");
        assert!(error.to_string().starts_with("Instagram needs a person"));
        assert!(error.to_string().contains(message));
        assert_eq!(page.lock().unwrap().submitted.len(), 1);
    }
}

#[test]
fn test_log_in_waits_for_a_late_emailed_code() {
    setup();
    // The inbox has nothing for 40 seconds; each 5 second wait moves the virtual clock.
    let mut codes = vec![None; 8];
    codes.push(Some("654321".to_owned()));
    let (page, mut session) = login_session_with(
        &["code", "pending", "done"],
        codes,
        LoginFault::None,
        Some(control().job_timeout_seconds),
    );
    session.log_in("wat2do.ucalgary", "s3cret").unwrap();
    assert!(
        page.lock()
            .unwrap()
            .clicked
            .contains(&scripts::submit_code("654321"))
    );
}

#[test]
fn test_log_in_clicks_save_info_once_while_the_page_stays_on_it() {
    setup();
    let (page, mut session) = login_session(
        &["save_info", "save_info", "save_info", "save_info", "done"],
        Vec::new(),
    );
    session.log_in("wat2do.ucalgary", "s3cret").unwrap();
    let save = scripts::SAVE_LOGIN.to_owned();
    assert_eq!(
        page.lock()
            .unwrap()
            .clicked
            .iter()
            .filter(|source| **source == save)
            .count(),
        1
    );
}

#[test]
fn test_log_in_clicks_save_again_when_its_button_was_not_there_yet() {
    setup();
    let (page, mut session) = login_session_with(
        &["save_info", "save_info", "save_info", "done"],
        Vec::new(),
        LoginFault::SaveButtonLate,
        Some(30.0),
    );
    session.log_in("wat2do.ucalgary", "s3cret").unwrap();
    let save = scripts::SAVE_LOGIN.to_owned();
    // Missing the first time, clicked the second, then never again.
    assert_eq!(
        page.lock()
            .unwrap()
            .clicked
            .iter()
            .filter(|source| **source == save)
            .count(),
        2
    );
}

#[test]
fn test_log_in_rides_out_brave_stalling_after_submit() {
    setup();
    let (page, mut session) = login_session_with(
        &["pending", "save_info", "done"],
        Vec::new(),
        LoginFault::BraveStallsTwice,
        Some(30.0),
    );
    session.log_in("wat2do.ucalgary", "s3cret").unwrap();
    let page = page.lock().unwrap();
    assert_eq!(page.stalls, 2);
    assert_eq!(page.submitted.len(), 1);
    assert!(
        page.clicked
            .iter()
            .any(|source| source == scripts::SAVE_LOGIN)
    );
}

#[test]
fn test_log_in_failure_after_submit_waits_for_a_person() {
    setup();
    let (page, mut session) =
        login_session_with(&["pending"], Vec::new(), LoginFault::PageStops, Some(30.0));
    let error = error_of(session.log_in("wat2do.ucalgary", "s3cret"));
    assert!(error.is(SessionKind::LoginSubmitted), "{error:?}");
    assert!(error.to_string().starts_with("Instagram needs a person"));
    assert_eq!(page.lock().unwrap().submitted.len(), 1);
}

#[test]
fn test_log_in_password_apple_event_error_waits_for_a_person() {
    setup();
    // The page may have run the source before the Apple Event failed.
    let (page, mut session) = login_session_with(
        &["pending"],
        Vec::new(),
        LoginFault::SecretFails,
        Some(30.0),
    );
    let error = error_of(session.log_in("wat2do.ucalgary", "s3cret"));
    assert!(error.is(SessionKind::LoginSubmitted), "{error:?}");
    assert!(error.to_string().starts_with("Instagram needs a person"));
    assert!(error.to_string().contains("Apple Event -1712"));
    assert_eq!(page.lock().unwrap().submitted.len(), 1);
}

// ---------------------------------------------------------------------------------------
// Accounts Instagram dropped from Brave

/// Instagram in the worker's tabs, holding `accounts` (the first is active).
///
/// Switch accounts opens the chooser, which lists the other accounts, once Brave holds
/// more than one (or `chooser` says so); with only one it opens a bare login form, as on
/// 11-09. Either dialog hides the page's navigation. A submitted password logs its
/// account in and makes it active.
struct Instagram {
    accounts: Vec<String>,
    chooser: bool,
    existing_account_button: bool,
    menu: bool,
    dialog: Option<&'static str>,
    logins: usize,
}

const DROPPED: [&str; 3] = ["wat2do.guelph", "wat2do.columbia", "wat2do.yorku"];

fn instagram_pool(accounts: &[&str], dialog: Option<&'static str>) -> (Pool, Shared<Instagram>) {
    let instagram = shared(Instagram {
        accounts: strings(accounts),
        chooser: false,
        existing_account_button: true,
        menu: false,
        dialog,
        logins: 0,
    });
    let page = instagram.clone();
    let url = format!("https://www.instagram.com/{}/", accounts[0]);
    let pool = registered_pool(2, &url, move |brave, tab, source| {
        let mut instagram = page.lock().unwrap();
        while instagram.logins < brave.secrets.len() {
            let secret = &brave.secrets[instagram.logins];
            let account = DROPPED
                .into_iter()
                .find(|account| secret.contains(account))
                .expect("a known account logs in")
                .to_owned();
            instagram.logins += 1;
            instagram.accounts.retain(|held| *held != account);
            instagram.accounts.insert(0, account);
            instagram.dialog = None;
        }
        if source == scripts::CANCEL_REQUEST {
            return ok("settled");
        }
        if source == scripts::CLEAR_REQUEST {
            return ok("cleared");
        }
        if source == scripts::CURRENT_PATH {
            return ok(&brave.path(tab));
        }
        if source == scripts::PAGE_RESPONSE {
            return ok(&json!({"path": brave.path(tab), "rate_limited": false}).to_string());
        }
        if source == scripts::SERVER_LOGIN {
            return ok("logged_in");
        }
        if source == scripts::CURRENT_ACCOUNT_USERNAME {
            // A modal hides the navigation that names the active account.
            return ok(if instagram.dialog.is_some() {
                ""
            } else {
                &instagram.accounts[0]
            });
        }
        if source.contains("activeRecipient") {
            return ok("true");
        }
        assert_eq!(tab, "1", "only the primary tab switches accounts");
        if source == scripts::OPEN_MORE {
            instagram.menu = true;
            return ok("clicked");
        }
        if source == scripts::SWITCH_BUTTON_STATE {
            return ok(if instagram.menu { "ready" } else { "pending" });
        }
        if source == scripts::CLICK_SWITCH_ACCOUNTS {
            instagram.menu = false;
            instagram.dialog = Some(if instagram.chooser || instagram.accounts.len() > 1 {
                "chooser"
            } else {
                "login"
            });
            return ok("clicked");
        }
        if source == scripts::ACCOUNT_CHOOSER_STATE {
            return ok(match instagram.dialog {
                Some("chooser") => "ready",
                Some(_) => "login",
                None => "pending",
            });
        }
        if source == scripts::CLOSE_ACCOUNT_CHOOSER {
            return ok(if instagram.dialog.take().is_some() {
                "clicked"
            } else {
                "missing"
            });
        }
        if source == scripts::LOGIN_FORM_STATE {
            let state = if instagram.dialog == Some("login") {
                "form"
            } else {
                "pending"
            };
            return ok(&json!({ "state": state }).to_string());
        }
        if source == scripts::click_label("Log into an Existing Account") {
            if instagram.dialog != Some("chooser") || !instagram.existing_account_button {
                return ok("missing");
            }
            instagram.dialog = Some("login");
            return ok("clicked");
        }
        if let Some(rest) = source
            .split_once("const username = \"")
            .map(|(_, rest)| rest)
        {
            // Only the other accounts are listed as entries to switch to.
            let username = rest.split('"').next().unwrap().to_owned();
            if instagram.dialog != Some("chooser") || !instagram.accounts[1..].contains(&username) {
                return ok("missing");
            }
            instagram.accounts.retain(|held| *held != username);
            instagram.accounts.insert(0, username);
            instagram.dialog = None;
            return ok("clicked");
        }
        panic!("unexpected page source: {source}");
    });
    pool.brave.lock().unwrap().passwords = DROPPED
        .iter()
        .map(|account| ((*account).to_owned(), format!("{account}-password")))
        .collect();
    (pool, instagram)
}

fn primary_sources(pool: &Pool) -> Vec<String> {
    pool.brave
        .lock()
        .unwrap()
        .sources
        .iter()
        .filter(|(tab, _)| tab == "1")
        .map(|(_, source)| source.clone())
        .collect()
}

/// The accounts whose passwords went to Instagram, in order.
fn passwords_entered(pool: &Pool) -> Vec<String> {
    pool.brave
        .lock()
        .unwrap()
        .secrets
        .iter()
        .map(|secret| {
            DROPPED
                .into_iter()
                .find(|account| secret.contains(&format!("{account}-password")))
                .unwrap()
                .to_owned()
        })
        .collect()
}

fn login_entered_today(pool: &Pool, username: &str) -> bool {
    pool.setting(&format!("account_login_at:{username}"))
        .is_number()
}

#[test]
fn test_switching_to_an_account_brave_lacks_closes_what_switch_accounts_opened() {
    setup();
    // The chooser lists other accounts but not this one; with no other account saved,
    // Switch accounts opens a bare login form instead.
    for accounts in [&["wat2do.guelph", "wat2do.yorku"][..], &["wat2do.yorku"]] {
        let (pool, instagram) = instagram_pool(accounts, None);
        let mut session = pool.session("1", true);
        let error = error_of(session.switch_account("wat2do.columbia"));
        assert!(error.is_session());
        assert_eq!(
            error.to_string(),
            "Matching Instagram browser account is unavailable"
        );
        // Nothing is left over the page, so its account reads again.
        assert_eq!(instagram.lock().unwrap().dialog, None);
        assert_eq!(
            session.current_account_username().unwrap().as_deref(),
            Some(accounts[0])
        );
        let sources = primary_sources(&pool);
        assert_eq!(count(&sources, scripts::CLOSE_ACCOUNT_CHOOSER), 1);
        assert_eq!(
            count(&sources, &scripts::click_account("wat2do.columbia")),
            usize::from(accounts.len() > 1),
            "a bare login form has no entries to click"
        );
    }
}

#[test]
fn test_a_login_form_left_open_is_closed_before_switching() {
    setup();
    let (pool, instagram) = instagram_pool(&["wat2do.yorku", "wat2do.guelph"], Some("login"));
    pool.session("1", true)
        .switch_account("wat2do.guelph")
        .unwrap();
    assert_eq!(instagram.lock().unwrap().accounts[0], "wat2do.guelph");
    let sources = primary_sources(&pool);
    assert_eq!(count(&sources, scripts::CLOSE_ACCOUNT_CHOOSER), 1);
    assert_eq!(count(&sources, scripts::CLICK_SWITCH_ACCOUNTS), 1);
}

#[test]
fn test_a_dropped_login_school_is_logged_in_before_the_missing_account() {
    setup();
    // 11-09: Instagram dropped every account but the active one, guelph included.
    let (pool, instagram) = instagram_pool(&["wat2do.yorku"], None);
    pool.pool.add_account("wat2do.columbia").unwrap();
    assert_eq!(
        instagram.lock().unwrap().accounts,
        strings(&["wat2do.columbia", "wat2do.guelph", "wat2do.yorku"])
    );
    assert_eq!(dialog_left(&instagram), None);
    // Guelph first, through the bare form; then the missing account from guelph.
    assert_eq!(
        passwords_entered(&pool),
        strings(&["wat2do.guelph", "wat2do.columbia"])
    );
    assert_eq!(
        count(
            &primary_sources(&pool),
            &scripts::click_label("Log into an Existing Account")
        ),
        1
    );
    // Each password entry counts against the same caps.
    assert!(login_entered_today(&pool, "wat2do.guelph"));
    assert!(login_entered_today(&pool, "wat2do.columbia"));
    assert_eq!(
        pool.setting("account_login_attempts")
            .as_array()
            .unwrap()
            .len(),
        2
    );
}

fn dialog_left(instagram: &Shared<Instagram>) -> Option<&'static str> {
    instagram.lock().unwrap().dialog
}

#[test]
fn test_an_active_login_school_is_used_even_under_a_chooser_left_open() {
    setup();
    // 11-09 21:33: guelph is active and a failed switch left the chooser over the page,
    // hiding which account is active.
    let (pool, instagram) = instagram_pool(&["wat2do.guelph"], Some("chooser"));
    instagram.lock().unwrap().chooser = true;
    pool.pool.add_account("wat2do.columbia").unwrap();
    assert_eq!(instagram.lock().unwrap().accounts[0], "wat2do.columbia");
    assert_eq!(passwords_entered(&pool), strings(&["wat2do.columbia"]));
    let sources = primary_sources(&pool);
    // Never a switch to the account that is already active.
    assert_eq!(count(&sources, &scripts::click_account("wat2do.guelph")), 0);
    assert_eq!(
        count(
            &sources,
            &scripts::click_label("Log into an Existing Account")
        ),
        1
    );
    assert!(!login_entered_today(&pool, "wat2do.guelph"));
}

#[test]
fn test_a_saved_login_school_is_switched_to_before_adding_the_account() {
    setup();
    let (pool, instagram) = instagram_pool(&["wat2do.yorku", "wat2do.guelph"], None);
    pool.pool.add_account("wat2do.columbia").unwrap();
    assert_eq!(
        instagram.lock().unwrap().accounts,
        strings(&["wat2do.columbia", "wat2do.guelph", "wat2do.yorku"])
    );
    assert_eq!(passwords_entered(&pool), strings(&["wat2do.columbia"]));
    assert_eq!(
        count(
            &primary_sources(&pool),
            &scripts::click_account("wat2do.guelph")
        ),
        1
    );
}

#[test]
fn test_a_dropped_login_school_is_added_through_the_bare_form_itself() {
    setup();
    let (pool, instagram) = instagram_pool(&["wat2do.yorku"], None);
    pool.pool.add_account("wat2do.guelph").unwrap();
    assert_eq!(instagram.lock().unwrap().accounts[0], "wat2do.guelph");
    assert_eq!(passwords_entered(&pool), strings(&["wat2do.guelph"]));
    let sources = primary_sources(&pool);
    // The bare form is the login form: nothing to click before the password.
    assert_eq!(
        count(
            &sources,
            &scripts::click_label("Log into an Existing Account")
        ),
        0
    );
    assert_eq!(count(&sources, scripts::CLOSE_ACCOUNT_CHOOSER), 0);
}

#[test]
fn test_no_password_is_typed_once_an_accounts_login_is_spent() {
    setup();
    let (pool, instagram) = instagram_pool(&["wat2do.guelph", "wat2do.yorku"], None);
    // Its password already went to Instagram today.
    assert!(
        pool.queue
            .reserve_account_login("wat2do.columbia", pool.host.time() - 3600.0)
            .unwrap()
    );
    let error = error_of(pool.pool.add_account("wat2do.columbia"));
    assert!(error.is_session());
    assert!(
        error
            .to_string()
            .contains("columbia's password was already entered today")
    );
    assert!(passwords_entered(&pool).is_empty());
    assert_eq!(dialog_left(&instagram), None);
    assert_eq!(
        count(&primary_sources(&pool), scripts::CLICK_SWITCH_ACCOUNTS),
        0,
        "refused before Switch accounts opens"
    );
}

#[test]
fn test_a_failure_before_the_password_spends_no_login() {
    setup();
    let (pool, instagram) = instagram_pool(&["wat2do.guelph", "wat2do.yorku"], None);
    instagram.lock().unwrap().existing_account_button = false;
    let error = error_of(pool.pool.add_account("wat2do.columbia"));
    assert!(error.is(SessionKind::PageUnavailable));
    assert!(error.to_string().contains("add-account control"));
    assert!(passwords_entered(&pool).is_empty());
    assert_eq!(dialog_left(&instagram), None);
    assert!(!login_entered_today(&pool, "wat2do.columbia"));
    assert_eq!(pool.setting("account_login_attempts"), Value::Null);
}

#[test]
fn test_a_digest_for_a_dropped_account_logs_it_in_and_then_runs() {
    use super::super::browser_worker::Worker;

    setup();
    // Every account but yorku dropped, as on 11-09: the digest's first preparation finds
    // its account missing, the worker logs guelph and then it in, and the digest runs.
    let (pool, instagram) = instagram_pool(&["wat2do.yorku"], None);
    let directory = tempfile::tempdir().unwrap();
    let mut worker = Worker::new(bridge(&pool.host), pool.queue.clone(), None);
    worker.seams.school_account_for = Arc::new(|_| None);
    worker.seams.browser_lock_path = directory.path().join("browser.lock");
    worker.seams.execute_job = Arc::new(
        |job: &BrowserJob, _: &mut BrowserInstagramSession, _: Option<&dyn Fn(&BrowserError)>| {
            assert_eq!(job.account_username, "wat2do.columbia");
            Ok(json!({"status": "succeeded"}))
        },
    );
    let job = pool
        .queue
        .enqueue_digest("123", "wat2do.columbia", "cache-entry:1")
        .unwrap();
    assert!(worker.process_next_job(true).unwrap());
    let finished = pool.queue.get(&job.id).unwrap().unwrap();
    assert_eq!(finished.state, "succeeded", "{:?}", finished.error);
    assert_eq!(instagram.lock().unwrap().accounts[0], "wat2do.columbia");
    assert_eq!(
        passwords_entered(&pool),
        strings(&["wat2do.guelph", "wat2do.columbia"])
    );
    assert_eq!(pool.setting("paused"), Value::Null);
}

/// `source` over a page whose elements report layout boxes: none when `data-hidden`.
fn evaluate_with_layout(html: &str, source: &str) -> Option<Value> {
    evaluate_on_page(
        html,
        &format!(
            "(Element.prototype.getClientRects = function() {{ \
               return this.attrs[\"data-hidden\"] ? [] : [{{}}]; }}, {source})"
        ),
    )
}

#[test]
fn test_clicks_skip_hidden_duplicates_of_a_control() {
    setup();
    // Since 11-12 Instagram's logged-out page renders each saved profile twice, one
    // copy hidden; recovery clicked neither ("ambiguous") and Brave stayed logged out.
    let profiles = "<main><div role='button' id='hidden' data-hidden='1'>wat2do.guelph</div>\
         <div role='button' id='shown'>wat2do.guelph</div>\
         <div role='button' id='other'>wat2do.mit</div></main>";
    let Some(result) = evaluate_with_layout(profiles, &scripts::click_label("wat2do.guelph"))
    else {
        return;
    };
    assert_eq!(result["status"], json!("clicked"));
    assert_eq!(result["clicks"], json!(["shown"]));
    let Some(result) = evaluate_with_layout(
        "<main><div role='dialog'><button id='hidden' data-hidden='1'>Save</button>\
         <button id='save'>Save</button><button id='later'>Not now</button></div></main>",
        scripts::SAVE_LOGIN,
    ) else {
        return;
    };
    assert_eq!(result["status"], json!("clicked"));
    assert_eq!(result["clicks"], json!(["save"]));
    let Some(result) = evaluate_with_layout(
        "<main><div role='dialog'><h2>Switch accounts</h2>\
         <div role='button' id='hidden' data-hidden='1'>wat2do.ubc</div>\
         <div role='button' id='ubc'>wat2do.ubc</div></div></main>",
        &scripts::click_account("wat2do.ubc"),
    ) else {
        return;
    };
    assert_eq!(result["status"], json!("clicked"));
    assert_eq!(result["clicks"], json!(["ubc"]));
    // Two on screen are still two controls.
    let Some(result) = evaluate_with_layout(
        "<main><div role='button' id='a'>wat2do.guelph</div>\
         <div role='button' id='b'>wat2do.guelph</div></main>",
        &scripts::click_label("wat2do.guelph"),
    ) else {
        return;
    };
    assert_eq!(result["status"], json!("ambiguous"));
    assert_eq!(result["clicks"], json!([]));
}

#[test]
fn test_save_login_accepts_instagrams_save_button_under_either_label() {
    setup();
    // Since November 2026 the one-tap prompt reads "Save" / "Not now"; it used to read
    // "Save info". Either is the one button the prompt offers to keep the login.
    for label in ["Save", "Save info"] {
        let html = format!(
            "<main><div role='dialog'><h2>Save your login info?</h2>\
             <button id='save'>{label}</button><button id='later'>Not now</button></div></main>"
        );
        let Some(result) = evaluate_on_page(&html, scripts::SAVE_LOGIN) else {
            return;
        };
        assert_eq!(result["status"], json!("clicked"), "{label}");
        assert_eq!(result["clicks"], json!(["save"]), "{label}");
    }
    // A button wrapped in a role="button" element with the same label is one control.
    let Some(result) = evaluate_on_page(
        "<main><div role='dialog'><div role='button' id='wrap'><button id='save'>Save</button></div>\
         <button id='later'>Not now</button></div></main>",
        scripts::SAVE_LOGIN,
    ) else {
        return;
    };
    assert_eq!(result["status"], json!("clicked"));
    assert_eq!(result["clicks"], json!(["save"]));
    let Some(result) = evaluate_on_page(
        "<main><button id='later'>Not now</button></main>",
        scripts::SAVE_LOGIN,
    ) else {
        return;
    };
    assert_eq!(result["status"], json!("missing"));
}
