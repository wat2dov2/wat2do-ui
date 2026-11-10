//! `BrowserInstagramSession`: identity, navigation, polling and the async request lifecycle.
//!
//! The worker holds its process-wide browser lock for an entire operation. All browser
//! consumers use this type, which also refuses to switch accounts until any prior
//! asynchronous request has stopped.

use std::sync::{Arc, LazyLock};

use regex::Regex;
use serde_json::Value;

use super::super::account_login;
use super::super::errors::{BrowserError, BrowserResult, SessionKind};
use super::super::scripts;
use super::bridge::{Bridge, TAB_CLOSED, TAB_LOADING};
use super::runner::{JavascriptRunner, PinnedRunner};
use super::{account_profile_url, canonical_post_url, validate_account_username};
use crate::controlbox::instagram_browser as control;
use crate::schools::validate_recipient_id;
use crate::urls::urlsplit;

static USERNAME_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[A-Za-z0-9._]{1,30}$").expect("valid regex"));

pub const ACCOUNT_UNAVAILABLE: &str = "Matching Instagram browser account is unavailable";
pub const LOGGED_OUT_PAUSE: &str =
    "Instagram browser requires human account recovery: log in to Instagram in Brave";
pub const CANCELLATION_UNCONFIRMED: &str = "cancellation could not be confirmed";

/// What Switch accounts opened.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum AccountChooser {
    /// Instagram's chooser, listing Brave's other saved accounts.
    Accounts,
    /// A bare login form: Brave holds no other saved account.
    LoginForm,
}

pub struct BrowserInstagramSession {
    pub(crate) bridge: Arc<Bridge>,
    runner: Box<dyn JavascriptRunner>,
    allow_account_switch: bool,
    deadline: Option<f64>,
    /// Whether this session's own in-flight request only reads; unknown (None) for
    /// anything an earlier session or process may have left on the page.
    pending_read_only: Option<bool>,
}

impl BrowserInstagramSession {
    pub fn new(
        bridge: Arc<Bridge>,
        runner: Box<dyn JavascriptRunner>,
        allow_account_switch: bool,
        job_timeout_seconds: Option<f64>,
    ) -> Self {
        let deadline = job_timeout_seconds
            .filter(|timeout| *timeout != 0.0)
            .map(|timeout| bridge.monotonic() + timeout);
        Self {
            bridge,
            runner,
            allow_account_switch,
            deadline,
            pending_read_only: None,
        }
    }

    /// A session on one pinned worker tab.
    pub fn on_tab(
        bridge: &Arc<Bridge>,
        tab_id: &str,
        allow_account_switch: bool,
        job_timeout_seconds: Option<f64>,
    ) -> Self {
        Self::new(
            bridge.clone(),
            Box::new(PinnedRunner::tab(bridge, tab_id)),
            allow_account_switch,
            job_timeout_seconds,
        )
    }

    /// Python's default session: a runner with no pinned tab, which fails on first use.
    pub fn unpinned(bridge: &Arc<Bridge>) -> Self {
        Self::new(
            bridge.clone(),
            Box::new(PinnedRunner::new(bridge.clone(), None)),
            true,
            None,
        )
    }

    /// The pinned Brave tab this session runs on, if it runs on one.
    pub(crate) fn pinned_runner(&mut self) -> Option<&mut PinnedRunner> {
        self.runner.pinned()
    }

    /// Start a fresh bounded job on a settled reusable tab.
    pub fn reset_job_deadline(&mut self, timeout_seconds: f64) {
        self.deadline = Some(self.bridge.monotonic() + timeout_seconds);
    }

    /// Require both the secondary role and an exact native tab owner.
    pub fn is_secondary_read_tab(&mut self) -> bool {
        !self.allow_account_switch && self.runner.pinned().is_some()
    }

    pub fn run(&mut self, source: &str) -> BrowserResult<String> {
        let timeout = self.remaining_timeout()?;
        Ok(self.runner.run(source, timeout)?.trim().to_owned())
    }

    /// Retry a read without replaying navigation, queries, or engagement clicks.
    pub fn read(&mut self, source: &str) -> BrowserResult<String> {
        let timeout = self.remaining_timeout()?;
        let bridge = self.bridge.clone();
        let runner = &mut self.runner;
        Ok(bridge
            .retry_operation(|timeout| runner.run(source, timeout), timeout)?
            .trim()
            .to_owned())
    }

    /// Allow a bounded account transition, then reject human recovery routes.
    pub fn current_page_path(&mut self, check_response: bool) -> BrowserResult<String> {
        let mut path = self.read_path(check_response)?;
        if path.starts_with("/accounts/login") {
            let grace = control()
                .account_transition_grace_seconds
                .min(self.remaining_timeout()?);
            self.bridge.sleep(grace)?;
            path = self.read_path(check_response)?;
        }
        if [
            "/accounts/login",
            "/accounts/suspended",
            "/challenge",
            "/checkpoint",
        ]
        .iter()
        .any(|prefix| path.starts_with(prefix))
        {
            return Err(BrowserError::session(
                "Instagram browser requires human account recovery",
            ));
        }
        Ok(path)
    }

    fn read_path(&mut self, check_response: bool) -> BrowserResult<String> {
        let raw = self.read(if check_response {
            scripts::PAGE_RESPONSE
        } else {
            scripts::CURRENT_PATH
        })?;
        if !check_response {
            return Ok(raw);
        }
        let invalid = || BrowserError::session("Instagram browser returned invalid page response");
        let response: Value = serde_json::from_str(&raw).map_err(|_| invalid())?;
        let Value::Object(response) = response else {
            return Err(invalid());
        };
        let (Some(Value::String(path)), Some(Value::Bool(rate_limited))) =
            (response.get("path"), response.get("rate_limited"))
        else {
            return Err(invalid());
        };
        if response.len() != 2 || !path.starts_with('/') {
            return Err(invalid());
        }
        if *rate_limited {
            return Err(BrowserError::rate_limited(
                "Instagram browser is rate limited (HTTP 429)",
            ));
        }
        Ok(path.clone())
    }

    /// Navigate from the page itself, which loads without raising Brave.
    pub fn navigate(&mut self, url: &str, reload: bool) -> BrowserResult<String> {
        let invalid = || BrowserError::session("Instagram browser navigation target is invalid");
        let target = urlsplit(url, "").map_err(|_| invalid())?;
        if target.scheme != "https"
            || target.netloc != "www.instagram.com"
            || !target.path.starts_with('/')
            || !target.query.is_empty()
            || !target.fragment.is_empty()
        {
            return Err(invalid());
        }
        let timeout = self.remaining_timeout()?;
        match self.runner.navigate(url, timeout, reload) {
            None => Err(BrowserError::session(
                "Instagram browser native navigation is unavailable",
            )),
            Some(result) => Ok(result?.trim().to_owned()),
        }
    }

    /// Destroy only a pinned secondary read document, then prove it no longer exists.
    pub fn retire_unresponsive_read_tab(&mut self) -> BrowserResult<()> {
        if !self.is_secondary_read_tab() {
            return Err(BrowserError::session(
                "Only a pinned secondary read tab may be retired",
            ));
        }
        let runner = self
            .runner
            .pinned()
            .expect("a secondary read tab is pinned");
        let (Some(tab_id), Some(window_id)) = (runner.tab_id.clone(), runner.window_id.clone())
        else {
            return Err(BrowserError::session(
                "The secondary read tab identity is unavailable",
            ));
        };
        self.bridge.close_owned_tab(&tab_id, &window_id)
    }

    pub(super) fn remaining_timeout(&self) -> BrowserResult<f64> {
        let mut timeout = control().request_timeout_seconds;
        if let Some(deadline) = self.deadline {
            let remaining = deadline - self.bridge.monotonic();
            if remaining <= 0.0 {
                return Err(BrowserError::Timeout(
                    "Instagram browser job exceeded its deadline".to_owned(),
                ));
            }
            timeout = timeout.min(remaining);
        }
        Ok(timeout)
    }

    pub fn activate_account(
        &mut self,
        recipient_id: &str,
        account_username: &str,
    ) -> BrowserResult<String> {
        let recipient_id = validate_recipient_id(recipient_id)
            .map_err(|_| BrowserError::session("Instagram browser recipient ID is invalid"))?;
        let username =
            validate_account_username(account_username).map_err(BrowserError::session)?;
        self.cancel_pending_request()?;
        if self.allow_account_switch {
            let timeout = self.remaining_timeout();
            if let Some(runner) = self.runner.pinned() {
                // Background renderers may retain a positive mobile viewport after the
                // existing window was resized. Refresh primary UI geometry before reading
                // or clicking its account and engagement controls.
                runner.warm_viewport(timeout?, true)?;
            }
        }
        match self.prepare_account(&recipient_id, &username, false) {
            Err(error) if error.is(SessionKind::PageUnavailable) => {
                self.navigate(&account_profile_url(&username)?, true)?;
                self.prepare_account(&recipient_id, &username, true)?;
            }
            other => other?,
        }
        Ok(username)
    }

    pub fn verify_account(&mut self, recipient_id: &str, username: &str) -> BrowserResult<()> {
        if self.current_account_username()?.as_deref() != Some(username)
            || self.read(&scripts::recipient_is_active(recipient_id))? != "true"
        {
            return Err(BrowserError::account_changed(
                "Instagram browser account does not match the intended account",
            ));
        }
        Ok(())
    }

    pub fn current_account_username(&mut self) -> BrowserResult<Option<String>> {
        let username = self.read(scripts::CURRENT_ACCOUNT_USERNAME)?;
        if username.is_empty() {
            return Ok(None);
        }
        if !USERNAME_PATTERN.is_match(&username) {
            return Err(BrowserError::session(
                "Active Instagram browser account is invalid or ambiguous",
            ));
        }
        Ok(Some(username.to_lowercase()))
    }

    pub fn navigate_post(
        &mut self,
        post_url: &str,
        recipient_id: &str,
        username: &str,
    ) -> BrowserResult<String> {
        let canonical_url = canonical_post_url(post_url)?;
        self.verify_account(recipient_id, username)?;
        if let Err(error) = self.navigate(&canonical_url, false) {
            if error.is_session() {
                return Err(BrowserError::session(format!(
                    "Instagram post navigation failed: {error}"
                )));
            }
            return Err(error);
        }
        let context = format!("({}).status", scripts::post_context(&canonical_url));
        let ready = self.poll_until(|session| {
            session.current_page_path(true)?;
            Ok(session.read(&context)? == "ready")
        });
        match ready {
            Err(error) if error.is(SessionKind::PageUnavailable) => {
                return Err(BrowserError::session(
                    "Instagram post did not become ready for the intended permalink",
                ));
            }
            other => other?,
        }
        match self.poll_until(|session| Ok(session.current_account_username()?.is_some())) {
            Err(error) if error.is(SessionKind::PageUnavailable) => {
                return Err(BrowserError::session(
                    "Instagram account identity did not become ready after opening the post",
                ));
            }
            other => other?,
        }
        self.verify_account(recipient_id, username)?;
        Ok(canonical_url)
    }

    /// Read result and settlement together; cancel every exit without that proof.
    ///
    /// `read_only` says the request cannot change anything on Instagram, so an
    /// unconfirmed cancellation of it is safe to abandon instead of pausing.
    pub fn query(
        &mut self,
        source: &str,
        read_only: bool,
    ) -> BrowserResult<serde_json::Map<String, Value>> {
        self.cancel_pending_request()?;
        let mut payload: Option<serde_json::Map<String, Value>> = None;
        let mut completion_settled = false;
        let outcome = (|| {
            self.pending_read_only = Some(read_only);
            self.run(source)?;
            self.poll_until(|session| {
                let raw = session.read(scripts::REQUEST_STATE)?;
                let invalid =
                    || BrowserError::session("Instagram browser returned invalid request state");
                let value: Value = serde_json::from_str(&raw).map_err(|_| invalid())?;
                let Value::Object(value) = value else {
                    if value.is_null() {
                        return Ok(false);
                    }
                    return Err(invalid());
                };
                let (Some(result), Some(Value::Bool(settled))) =
                    (value.get("result"), value.get("settled"))
                else {
                    return Err(invalid());
                };
                if value.len() != 2 {
                    return Err(invalid());
                }
                if result.is_null() {
                    return Ok(false);
                }
                let Value::Object(result) = result else {
                    return Err(invalid());
                };
                let state = result.get("state").and_then(Value::as_str);
                if !matches!(state, Some("pending" | "succeeded" | "failed")) {
                    return Err(invalid());
                }
                if state == Some("pending") {
                    return Ok(false);
                }
                payload = Some(result.clone());
                completion_settled = *settled;
                Ok(completion_settled)
            })
        })();
        if !completion_settled && let Err(cleanup) = self.cancel_pending_request() {
            if cleanup.is_session() && self.is_secondary_read_tab() {
                return Err(BrowserError::ReadCleanupPending {
                    message: cleanup.to_string(),
                    operation_error: outcome.err().map(Box::new),
                    completed_payload: payload.map(Value::Object),
                });
            }
            return Err(cleanup);
        }
        outcome?;
        payload.ok_or_else(|| BrowserError::session("Instagram browser returned no request result"))
    }

    /// Abort and await settlement, including requests left by an interrupted job.
    pub fn cancel_pending_request(&mut self) -> BrowserResult<()> {
        let job_deadline = self.deadline;
        let cleanup_budget = if self.allow_account_switch {
            control().interaction_timeout_seconds
        } else {
            control().secondary_cleanup_timeout_seconds
        };
        let cleanup_deadline = self.bridge.monotonic() + cleanup_budget;
        self.deadline = Some(cleanup_deadline);
        let mut last_error: Option<BrowserError> = None;
        let attempt = (|| {
            for attempt in 0..control().bridge_retry_limit {
                let settled = self
                    .poll_until(|session| Ok(session.run(scripts::CANCEL_REQUEST)? == "settled"))
                    .and_then(|()| self.run(scripts::CLEAR_REQUEST));
                match settled {
                    Ok(_) => {
                        self.pending_read_only = None;
                        return Ok(());
                    }
                    Err(error) if error.is(SessionKind::AutomationTransient) => {
                        last_error = Some(error.clone());
                        let remaining = cleanup_deadline - self.bridge.monotonic();
                        if remaining <= 0.0 || attempt + 1 == control().bridge_retry_limit {
                            return Err(error);
                        }
                        self.bridge
                            .sleep(control().poll_interval_seconds.min(remaining))?;
                    }
                    Err(error) => return Err(error),
                }
            }
            unreachable!("Validated bridge retry limit must be positive")
        })();
        let result = match attempt {
            Ok(()) => Ok(()),
            Err(error) if error.is_session() => {
                if error.to_string() == TAB_CLOSED {
                    // Its document no longer exists; no async page request can be reused.
                    Ok(())
                } else if self.abandon_read_only_request() {
                    Ok(())
                } else {
                    Err(BrowserError::session(format!(
                        "Instagram browser request {CANCELLATION_UNCONFIRMED}: {error}"
                    )))
                }
            }
            Err(BrowserError::Timeout(_)) => {
                if self.abandon_read_only_request() {
                    Ok(())
                } else {
                    let reason = last_error.map_or_else(
                        || "the browser job deadline expired".to_owned(),
                        |error| error.to_string(),
                    );
                    Err(BrowserError::session(format!(
                        "Instagram browser request {CANCELLATION_UNCONFIRMED}: {reason}"
                    )))
                }
            }
            Err(other) => Err(other),
        };
        self.deadline = job_deadline;
        result
    }

    /// Drop this session's own unconfirmed read instead of pausing for a person.
    ///
    /// A read cannot change anything on Instagram, and its late result lands in its own
    /// request object rather than the next query's, so nothing can reuse it. A secondary
    /// read tab keeps its stronger cleanup: its document is closed.
    fn abandon_read_only_request(&mut self) -> bool {
        if self.pending_read_only != Some(true) || self.is_secondary_read_tab() {
            return false;
        }
        self.pending_read_only = None;
        true
    }

    pub fn poll_until(
        &mut self,
        completed: impl FnMut(&mut Self) -> BrowserResult<bool>,
    ) -> BrowserResult<()> {
        self.poll_until_within(control().interaction_timeout_seconds, completed)
    }

    /// `poll_until` with its own budget instead of `interaction_timeout_seconds`.
    pub fn poll_until_within(
        &mut self,
        seconds: f64,
        mut completed: impl FnMut(&mut Self) -> BrowserResult<bool>,
    ) -> BrowserResult<()> {
        let deadline = self.bridge.monotonic() + seconds;
        let job_deadline = self.deadline;
        self.deadline = Some(job_deadline.map_or(deadline, |job| deadline.min(job)));
        let result = (|| {
            while self.bridge.monotonic() < self.deadline.expect("poll deadline is set") {
                match completed(self) {
                    Ok(true) => return Ok(()),
                    Ok(false) => {}
                    Err(error)
                        if error.is(SessionKind::PageUnavailable)
                            && error.to_string() == TAB_LOADING => {}
                    Err(error) => return Err(error),
                }
                let remaining =
                    self.deadline.expect("poll deadline is set") - self.bridge.monotonic();
                if remaining > 0.0 {
                    self.bridge
                        .sleep(control().poll_interval_seconds.min(remaining))?;
                }
            }
            Err(BrowserError::page_unavailable(
                "Instagram browser automation timed out",
            ))
        })();
        self.deadline = job_deadline;
        result
    }

    pub(super) fn prepare_account(
        &mut self,
        recipient_id: &str,
        username: &str,
        check_response: bool,
    ) -> BrowserResult<()> {
        let mut active_username: Option<String> = None;
        self.poll_until(|session| {
            if check_response {
                session.current_page_path(true)?;
            }
            active_username = session.current_account_username()?;
            Ok(active_username.is_some())
        })?;
        if active_username.as_deref() != Some(username) {
            if !self.allow_account_switch {
                return Err(BrowserError::account_changed(
                    "Instagram browser account changed during parallel work",
                ));
            }
            self.switch_account(username)?;
        }
        self.verify_account(recipient_id, username)?;
        self.close_account_chooser()
    }

    /// Fill and submit the login form on the page, then answer what Instagram asks.
    ///
    /// Saves the login info, and enters an emailed security code when Instagram asks
    /// for one. A wrong password or any other challenge stops for a person.
    pub fn log_in(&mut self, username: &str, password: &str) -> BrowserResult<()> {
        if self.runner.pinned().is_none() {
            return Err(BrowserError::session(
                "Instagram login needs a pinned Brave tab",
            ));
        }
        self.poll_until(|session| Ok(session.login_state()? == "form"))?;
        let submitted_at = self.bridge.time();
        let source = scripts::submit_login(username, password);
        let timeout = self.remaining_timeout()?;
        let runner = self.runner.pinned().expect("checked above");
        // osascript ends its output with a newline; Python compared it unstripped and so
        // treated every submitted form as refused (a bug fixed here).
        let submitted = match runner.run_secret(&source, timeout) {
            Ok(submitted) => submitted,
            // The page may have run the source before the Apple Event failed.
            Err(error) => return Err(submitted_login(username, &error)),
        };
        if submitted.trim() != "submitted" {
            return Err(BrowserError::session(
                "Instagram's login form could not be submitted",
            ));
        }
        // The password has reached Instagram: from here every failure waits for a person.
        self.settle_submitted_login(username, submitted_at)
            .map_err(|error| submitted_login(username, &error))
    }

    /// Wait for Instagram's answer to a submitted login: accept "Save info" once and
    /// enter an emailed security code once. Its own deadline covers the code's wait.
    fn settle_submitted_login(&mut self, username: &str, submitted_at: f64) -> BrowserResult<()> {
        let mut code_entered = false;
        let mut save_clicked = false;
        let mut state = String::new();
        let bridge = self.bridge.clone();
        let window = control().login_code_wait_seconds + control().interaction_timeout_seconds;
        self.poll_until_within(window, |session| {
            state = session.login_state()?;
            if state == "save_info" {
                // One click; the page then navigates away on its own.
                if !save_clicked {
                    session.run(&scripts::click_label("Save info"))?;
                    save_clicked = true;
                }
                return Ok(false);
            }
            if state == "code" && !code_entered {
                let deadline = session.deadline.unwrap_or_else(|| bridge.monotonic());
                let Some(code) =
                    account_login::emailed_code(&bridge, username, submitted_at, deadline)?
                else {
                    return Err(BrowserError::of(
                        SessionKind::LoginSubmitted,
                        "Instagram needs a person: its security code never arrived",
                    ));
                };
                if session.run(&scripts::submit_code(&code))? != "submitted" {
                    return Err(BrowserError::session(
                        "Instagram's security code could not be entered",
                    ));
                }
                code_entered = true;
                return Ok(false);
            }
            if state == "wrong_password" || state == "challenge" {
                return Ok(true);
            }
            Ok(session.current_account_username()?.as_deref() == Some(username))
        })?;
        if state == "wrong_password" {
            return Err(BrowserError::of(
                SessionKind::LoginSubmitted,
                format!("Instagram needs a person: it refused {username}'s password"),
            ));
        }
        if state == "challenge" {
            return Err(BrowserError::of(
                SessionKind::LoginSubmitted,
                format!("Instagram needs a person: it asks to confirm {username}"),
            ));
        }
        Ok(())
    }

    fn login_state(&mut self) -> BrowserResult<String> {
        let raw = self.read(scripts::LOGIN_FORM_STATE)?;
        Ok(match serde_json::from_str::<Value>(&raw) {
            Ok(Value::Object(state)) => state
                .get("state")
                .map(crate::pyjson::str)
                .unwrap_or_default(),
            // Python called .get on whatever json.loads returned; only a dict answers.
            Ok(_) => {
                return Err(BrowserError::other(
                    "AttributeError",
                    "Instagram login state is not an object",
                ));
            }
            Err(_) => String::new(),
        })
    }

    /// The active account, read once no dialog from Switch accounts covers the page.
    pub(super) fn active_account(&mut self) -> BrowserResult<String> {
        self.close_account_chooser()?;
        let mut username: Option<String> = None;
        self.poll_until(|session| {
            username = session.current_account_username()?;
            Ok(username.is_some())
        })?;
        Ok(username.expect("the poll ends once an account is read"))
    }

    /// Open Instagram's login form the way a person adds an account: Switch accounts,
    /// then "Log into an Existing Account" when it lists Brave's other saved accounts,
    /// or the bare form it opens when Brave holds no other.
    pub(super) fn open_login_form(&mut self) -> BrowserResult<()> {
        if self.open_account_chooser()? == AccountChooser::Accounts
            && self.run(&scripts::click_label("Log into an Existing Account"))? != "clicked"
        {
            self.close_account_chooser()?;
            return Err(BrowserError::page_unavailable(
                "Instagram's add-account control is unavailable",
            ));
        }
        self.poll_until(|session| Ok(session.login_state()? == "form"))
    }

    fn account_chooser(&mut self) -> BrowserResult<Option<AccountChooser>> {
        Ok(match self.read(scripts::ACCOUNT_CHOOSER_STATE)?.as_str() {
            "ready" => Some(AccountChooser::Accounts),
            "login" => Some(AccountChooser::LoginForm),
            _ => None,
        })
    }

    /// Close any dialog Switch accounts left open and wait until it is gone: a modal
    /// hides the page's navigation, and with it the active account.
    pub(super) fn close_account_chooser(&mut self) -> BrowserResult<()> {
        if self.account_chooser()?.is_none() {
            return Ok(());
        }
        if self.run(scripts::CLOSE_ACCOUNT_CHOOSER)? != "clicked" {
            return Err(BrowserError::session(
                "Instagram account chooser could not be closed",
            ));
        }
        self.poll_until(|session| Ok(session.account_chooser()?.is_none()))
    }

    fn open_account_chooser(&mut self) -> BrowserResult<AccountChooser> {
        match self.account_chooser()? {
            Some(AccountChooser::Accounts) => return Ok(AccountChooser::Accounts),
            // A login form left open says nothing about which accounts Brave holds.
            Some(AccountChooser::LoginForm) => self.close_account_chooser()?,
            None => {}
        }
        if self.read(scripts::SWITCH_BUTTON_STATE)? != "ready" {
            if self.run(scripts::OPEN_MORE)? != "clicked" {
                return Err(BrowserError::page_unavailable(
                    "Instagram account switch control is unavailable",
                ));
            }
            self.poll_until(|session| Ok(session.read(scripts::SWITCH_BUTTON_STATE)? == "ready"))?;
        }
        if self.run(scripts::CLICK_SWITCH_ACCOUNTS)? != "clicked" {
            return Err(BrowserError::page_unavailable(
                "Instagram account switch control is unavailable",
            ));
        }
        let mut opened: Option<AccountChooser> = None;
        self.poll_until(|session| {
            opened = session.account_chooser()?;
            Ok(opened.is_some())
        })?;
        Ok(opened.expect("the poll ends once Switch accounts opened"))
    }

    /// Select `username` in Switch accounts; `ACCOUNT_UNAVAILABLE` when Brave lacks it,
    /// with the chooser closed again.
    pub(super) fn switch_account(&mut self, username: &str) -> BrowserResult<()> {
        let selected = match self.open_account_chooser()? {
            AccountChooser::Accounts => Some(self.run(&scripts::click_account(username))?),
            // Brave holds no other saved account, so this one is missing too.
            AccountChooser::LoginForm => None,
        };
        if selected.as_deref() != Some("clicked") {
            self.close_account_chooser()?;
            return Err(BrowserError::session(
                if selected.as_deref() == Some("ambiguous") {
                    "Matching Instagram browser account is ambiguous"
                } else {
                    ACCOUNT_UNAVAILABLE
                },
            ));
        }
        self.poll_until(|session| {
            session.current_page_path(true)?;
            Ok(session.current_account_username()?.as_deref() == Some(username))
        })
    }
}

/// A failure after the password reached Instagram: never retried, and the worker pauses
/// for a person, who checks what Instagram shows before anything logs in again.
fn submitted_login(username: &str, error: &BrowserError) -> BrowserError {
    if error.is(SessionKind::LoginSubmitted) {
        return error.clone();
    }
    BrowserError::of(
        SessionKind::LoginSubmitted,
        format!(
            "Instagram needs a person: the login for {username} was submitted but did not finish ({})",
            if error.is_interrupted() {
                "the worker was stopping".to_owned()
            } else {
                error.to_string()
            }
        ),
    )
}
