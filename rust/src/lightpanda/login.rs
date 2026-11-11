//! Logging a school account in to its own Lightpanda jar, the way a person would on
//! Instagram's login page: username, the Keychain password, Enter, and the emailed
//! security code when Instagram asks for one.
//!
//! A login spends the account's place in the daily budget it shares with Brave, and
//! a first login (a new device to Instagram) also spends one of the day's
//! `new_login_daily_limit` places. A wrong password, a security check or anything
//! else this code does not recognise pauses the account until a person clears it;
//! nothing is retried blindly.

use std::sync::{Arc, LazyLock};
use std::time::{Duration, Instant};

use anyhow::Context;
use regex::Regex;
use serde::Deserialize;
use serde_json::{Value, json};

use super::Lightpanda;
use super::browser::{Browser, Page};
use super::scripts;
use crate::controlbox::{INSTAGRAM_LIGHTPANDA as CONTROL, instagram_browser};
use crate::instagram_notifications::account_login;
use crate::instagram_notifications::browser_queue::{
    BrowserJobQueue, LoginReservation, recent_timestamps,
};
use crate::instagram_notifications::browser_session::Bridge;

pub const LOGIN_URL: &str = "https://www.instagram.com/accounts/login/";
/// First Lightpanda logins of the last day, across accounts.
const NEW_LOGINS: &str = "lightpanda_new_logins";

/// Why `account` waits for a person, when it does.
fn paused_key(account: &str) -> String {
    format!("lightpanda_paused:{account}")
}

/// What Lightpanda's page showed after the login went in.
#[derive(Debug, Deserialize)]
pub struct PageState {
    pub path: String,
    pub login_form: bool,
    pub code_field: bool,
    pub text: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PageOutcome {
    /// Still loading or still on the form.
    Pending,
    /// Instagram asks for the security code it emailed.
    Code,
    WrongPassword,
    /// A security check, a suspension or a refusal only a person can answer.
    Challenge,
}

static SUSPENDED: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^/accounts/(suspended|disabled)").expect("valid regex"));
static CHECKPOINT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^/(challenge|checkpoint)(/|$)").expect("valid regex"));
static CODE_PAGE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^/(auth_platform|two_factor|accounts/login/two_factor)(/|$)").expect("valid regex")
});
const WRONG_PASSWORD_WORDS: [&str; 4] = [
    "password was incorrect",
    "password is incorrect",
    "incorrect password",
    "the password you entered",
];
const CODE_WORDS: [&str; 6] = [
    "security code",
    "enter the code",
    "check your email",
    "confirmation code",
    "6-digit",
    "we sent",
];
const CHALLENGE_WORDS: [&str; 8] = [
    "suspicious",
    "unusual login",
    "help us confirm",
    "confirm it's you",
    "automated behavior",
    "we suspended",
    "wait a few minutes",
    "there was a problem logging you",
];

/// Read the page after the login went in.
pub fn classify(state: &PageState) -> PageOutcome {
    let text = state.text.to_lowercase();
    let says = |words: &[&str]| words.iter().any(|word| text.contains(word));
    if SUSPENDED.is_match(&state.path) {
        return PageOutcome::Challenge;
    }
    if state.code_field {
        return PageOutcome::Code;
    }
    if says(&WRONG_PASSWORD_WORDS) {
        return PageOutcome::WrongPassword;
    }
    if CHECKPOINT.is_match(&state.path) {
        return if says(&CODE_WORDS) {
            PageOutcome::Code
        } else {
            PageOutcome::Challenge
        };
    }
    if CODE_PAGE.is_match(&state.path) || says(&CODE_WORDS) {
        return PageOutcome::Code;
    }
    if says(&CHALLENGE_WORDS) {
        return PageOutcome::Challenge;
    }
    PageOutcome::Pending
}

/// How a login attempt ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LoginResult {
    /// The jar already held a working login; nothing was sent.
    AlreadyLoggedIn,
    LoggedIn {
        new_device: bool,
    },
    /// Not attempted, and nothing sent to Instagram.
    Skipped(String),
    /// Instagram refused or questioned the login; the account waits for a person.
    Paused(String),
}

/// Why the account waits for a person, if it does.
pub fn paused(queue: &BrowserJobQueue, account: &str) -> anyhow::Result<Option<String>> {
    Ok(queue
        .get_setting(&paused_key(account))?
        .and_then(|reason| reason.as_str().map(str::to_owned)))
}

/// Let the account log in again after a person has checked it.
pub fn resume(queue: &BrowserJobQueue, account: &str) -> anyhow::Result<()> {
    Ok(queue.set_setting(&paused_key(account), Value::Null)?)
}

fn pause(queue: &BrowserJobQueue, account: &str, reason: &str) -> anyhow::Result<LoginResult> {
    queue.set_setting(&paused_key(account), json!(reason))?;
    Ok(LoginResult::Paused(reason.to_owned()))
}

/// Whether today's first-login places are spent.
pub fn ramp_full(queue: &BrowserJobQueue, now: f64) -> anyhow::Result<bool> {
    let recent = recent_timestamps(&queue.setting_or(NEW_LOGINS, json!([]))?, now);
    Ok(recent.len() >= CONTROL.new_login_daily_limit)
}

/// Spend the account's login for the day and, for a new device, one first-login
/// place, leaving `keep` of the day's logins unspent, all in one queue transaction.
/// False, spending nothing, when any is gone.
pub fn reserve(
    queue: &BrowserJobQueue,
    account: &str,
    new_device: bool,
    keep: usize,
    now: f64,
) -> anyhow::Result<bool> {
    let reservation = LoginReservation {
        keep,
        first_login: new_device.then_some((NEW_LOGINS, CONTROL.new_login_daily_limit)),
    };
    Ok(queue.reserve_login(account, now, &reservation)?)
}

/// Log `account` in to its Lightpanda jar unless it already holds a login. The
/// Keychain password and the emailed code come through `bridge` (the Brave worker's
/// Keychain and Gmail reader); the budget, ramp and pauses live in the worker's queue.
pub async fn log_in(
    lightpanda: &Lightpanda,
    queue: &BrowserJobQueue,
    bridge: Arc<Bridge>,
    account: &str,
    keep: usize,
) -> anyhow::Result<LoginResult> {
    if let Some(reason) = paused(queue, account)? {
        return Ok(LoginResult::Skipped(format!(
            "paused for a person: {reason}"
        )));
    }
    let new_device = lightpanda.jar(account)?.is_new_device();
    if new_device && ramp_full(queue, bridge.time())? {
        return Ok(LoginResult::Skipped(format!(
            "{} accounts already logged in to Lightpanda for the first time today",
            CONTROL.new_login_daily_limit
        )));
    }
    let mut browser = lightpanda.open(account).await?;
    let attempt = attempt(&mut browser, queue, bridge, account, new_device, keep).await;
    let closed = browser.close().await;
    let result = attempt?;
    closed?;
    Ok(result)
}

async fn attempt(
    browser: &mut Browser,
    queue: &BrowserJobQueue,
    bridge: Arc<Bridge>,
    account: &str,
    new_device: bool,
    keep: usize,
) -> anyhow::Result<LoginResult> {
    if browser.has_session().await? {
        return Ok(LoginResult::AlreadyLoggedIn);
    }
    let (keychain, owned) = (bridge.clone(), account.to_owned());
    let password =
        tokio::task::spawn_blocking(move || account_login::account_password(&keychain, &owned))
            .await?;
    let Some(password) = password else {
        return Ok(LoginResult::Skipped(
            "the Keychain holds no password".into(),
        ));
    };
    browser.delete_session().await?;
    browser.navigate(LOGIN_URL).await?;
    if !wait_for_form(browser).await? {
        return Ok(LoginResult::Skipped("the login form never appeared".into()));
    }
    if !reserve(queue, account, new_device, keep, bridge.time())? {
        return Ok(LoginResult::Skipped(
            "the account's login for today is spent".into(),
        ));
    }
    browser.evaluate(scripts::FOCUS_USERNAME).await?;
    browser.insert_text(account).await?;
    if browser.evaluate(scripts::FOCUS_PASSWORD).await? != "focused" {
        return pause(queue, account, "the login form lost its password field");
    }
    // From the first keystroke of the password on, the login counts as sent: any
    // failure waits for a person, and nothing is retried.
    let submitted_at = bridge.time();
    let sent = async {
        browser.insert_text(&password).await?;
        browser.press_enter().await?;
        answer(browser, queue, bridge, account, new_device, submitted_at).await
    }
    .await;
    drop(password);
    match sent {
        Ok(result) => Ok(result),
        Err(error) => pause(
            queue,
            account,
            &format!("the login failed after the password was sent ({error:#})"),
        ),
    }
}

/// Follow the login after the password went in: done, refused, or a code to type.
async fn answer(
    browser: &mut Browser,
    queue: &BrowserJobQueue,
    bridge: Arc<Bridge>,
    account: &str,
    new_device: bool,
    submitted_at: f64,
) -> anyhow::Result<LoginResult> {
    match outcome(browser).await? {
        Outcome::LoggedIn => return Ok(LoginResult::LoggedIn { new_device }),
        Outcome::Page(PageOutcome::Code, _) => {}
        Outcome::Page(outcome, path) => return pause(queue, account, &refusal(outcome, &path)),
    }
    let owned = account.to_owned();
    let code = tokio::task::spawn_blocking(move || {
        let deadline = bridge.monotonic() + instagram_browser().login_code_wait_seconds;
        account_login::emailed_code(&bridge, &owned, submitted_at, deadline)
    })
    .await?;
    // An inbox that could not be read is the same as no code: a person checks it.
    let Ok(Some(code)) = code else {
        return pause(
            queue,
            account,
            "Instagram asked for an emailed code and none arrived",
        );
    };
    if browser.evaluate(scripts::FOCUS_CODE).await? != "focused" {
        return pause(
            queue,
            account,
            "Instagram asked for a code but showed no code field",
        );
    }
    browser.insert_text(&code).await?;
    drop(code);
    browser.press_enter().await?;
    match outcome(browser).await? {
        Outcome::LoggedIn => Ok(LoginResult::LoggedIn { new_device }),
        Outcome::Page(PageOutcome::Code, _) => {
            pause(queue, account, "Instagram did not accept the emailed code")
        }
        Outcome::Page(outcome, path) => pause(queue, account, &refusal(outcome, &path)),
    }
}

/// The reason a refused login waits for a person. It names the page, never its text.
fn refusal(outcome: PageOutcome, path: &str) -> String {
    match outcome {
        PageOutcome::WrongPassword => "Instagram said the password is wrong".into(),
        PageOutcome::Challenge => format!("Instagram asked for a security check ({path})"),
        PageOutcome::Code => "Instagram asked for another code".into(),
        PageOutcome::Pending => format!(
            "Instagram did not answer the login within {} s ({path})",
            CONTROL.login_wait_seconds
        ),
    }
}

/// Wait for the username field, as long as a page load may take.
async fn wait_for_form(browser: &mut Browser) -> anyhow::Result<bool> {
    let deadline = Instant::now() + Duration::from_secs_f64(CONTROL.navigation_timeout_seconds);
    loop {
        let state = page_state(browser).await?;
        if state.login_form {
            return Ok(true);
        }
        if Instant::now() >= deadline {
            return Ok(false);
        }
        tokio::time::sleep(Duration::from_secs_f64(CONTROL.login_poll_seconds)).await;
    }
}

enum Outcome {
    LoggedIn,
    /// What the page showed, and where it was.
    Page(PageOutcome, String),
}

/// Wait for a login cookie or a page that answers the login.
async fn outcome(browser: &mut Browser) -> anyhow::Result<Outcome> {
    let deadline = Instant::now() + Duration::from_secs_f64(CONTROL.login_wait_seconds);
    let mut path = String::new();
    while Instant::now() < deadline {
        tokio::time::sleep(Duration::from_secs_f64(CONTROL.login_poll_seconds)).await;
        if browser.has_session().await? {
            return Ok(Outcome::LoggedIn);
        }
        // The page may be between documents; the next poll reads it again.
        let Ok(state) = page_state(browser).await else {
            continue;
        };
        path = state.path.clone();
        let outcome = classify(&state);
        if outcome != PageOutcome::Pending {
            return Ok(Outcome::Page(outcome, path));
        }
    }
    Ok(Outcome::Page(PageOutcome::Pending, path))
}

async fn page_state(browser: &mut Browser) -> anyhow::Result<PageState> {
    let state = browser.evaluate(scripts::PAGE_STATE).await?;
    serde_json::from_str(state.as_str().unwrap_or("null")).context("the page state is unreadable")
}

#[cfg(test)]
#[path = "tests/login.rs"]
mod tests;
