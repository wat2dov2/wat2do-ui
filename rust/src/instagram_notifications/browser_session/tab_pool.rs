//! `BrowserTabPool`: worker-owned popup windows in the existing Brave session.
//!
//! Each worker tab is the only tab of its own popup window, so a person can use Brave
//! freely: their links and new tabs never land in a worker window. A worker window that
//! is closed, browsed away from or otherwise lost is simply forgotten and replaced; one
//! browsed elsewhere is left for the person. Each new tab is persisted immediately and
//! the configured total is kept, with the first as the primary tab. Account switching
//! happens only after every pool tab's previous asynchronous request has settled.

use std::sync::Arc;

use serde_json::Value;

use super::super::account_login;
use super::super::browser_queue::{BrowserJob, BrowserJobQueue};
use super::super::errors::{BrowserError, BrowserResult, SessionKind};
use super::super::scripts;
use super::bridge::{Bridge, is_ascii_digits};
use super::runner::{JavascriptRunner, PinnedRunner};
use super::session::{BrowserInstagramSession, CANCELLATION_UNCONFIRMED, LOGGED_OUT_PAUSE};
use super::{WAT2DO_ACCOUNT_PATTERN, account_profile_url, school_account_username};
use crate::controlbox::instagram_browser as control;
use crate::pyjson;

/// What the worker asks of its tabs; the browser pool, or a test's stand-in.
pub trait TabPool {
    /// Settle every tab, verify the batch's account and hand out its secondary tabs.
    fn prepare(
        &self,
        job: &BrowserJob,
        count: usize,
    ) -> BrowserResult<(Vec<BrowserInstagramSession>, String)>;
    /// Restore the configured number of worker windows without changing accounts.
    fn ensure_capacity(&self, bootstrap_username: Option<&str>) -> BrowserResult<Vec<String>>;
    /// Settle every owned tab; retire only failed secondary reads.
    fn settle_registered_tabs(&self) -> BrowserResult<Vec<BrowserInstagramSession>>;
    /// Log back in through Instagram's saved profiles after a logout.
    fn recover_login(&self) -> BrowserResult<String>;
    /// Log in an account missing from Brave's switcher.
    fn add_account(&self, username: &str) -> BrowserResult<()>;
}

pub struct BrowserTabPool {
    bridge: Arc<Bridge>,
    queue: Arc<BrowserJobQueue>,
}

impl BrowserTabPool {
    pub fn new(bridge: Arc<Bridge>, queue: Arc<BrowserJobQueue>) -> Self {
        Self { bridge, queue }
    }

    fn registered_ids(&self) -> BrowserResult<Vec<String>> {
        let invalid =
            || BrowserError::session("Worker tab registry is invalid; inspect before retrying");
        let ids = match self.queue.get_setting("browser_tab_ids")? {
            None => return Ok(Vec::new()),
            Some(Value::Array(ids)) => ids,
            Some(_) => return Err(invalid()),
        };
        let mut seen = Vec::new();
        for id in ids {
            let Value::String(id) = id else {
                return Err(invalid());
            };
            if !is_ascii_digits(&id) || seen.contains(&id) {
                return Err(invalid());
            }
            seen.push(id);
        }
        Ok(seen)
    }

    fn save(&self, ids: &[String]) -> BrowserResult<()> {
        self.queue
            .set_setting("browser_tab_ids", Value::from(ids.to_vec()))
    }

    fn pinned(&self, tab_id: &str) -> PinnedRunner {
        PinnedRunner::tab(&self.bridge, tab_id)
    }

    /// Registered tabs still open on Instagram, in registry order.
    fn live_ids(&self, ids: &[String]) -> BrowserResult<Vec<String>> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let inventory = self.bridge.read_applescript(
            scripts::LIVE_WORKER_TABS,
            ids,
            control().request_timeout_seconds,
        )?;
        let live: Vec<&str> = inventory.split_whitespace().collect();
        if live.iter().any(|tab_id| !ids.iter().any(|id| id == tab_id)) {
            return Err(BrowserError::session(
                "Brave returned an invalid worker tab inventory",
            ));
        }
        Ok(ids
            .iter()
            .filter(|id| live.contains(&id.as_str()))
            .cloned()
            .collect())
    }

    /// Open a popup between keystrokes, then hand focus back to whoever had it.
    ///
    /// Brave raises itself whenever it creates a window, so this is the only worker
    /// action that can take focus; page loads never do.
    pub(super) fn open_window(
        &self,
        opener_tab_id: Option<&str>,
        initial_url: &str,
    ) -> BrowserResult<String> {
        let bridge = &self.bridge;
        let quiet_by = bridge.monotonic() + control().worker_window_idle_wait_seconds;
        while bridge.input_idle_seconds() < control().worker_window_idle_seconds
            && bridge.monotonic() < quiet_by
        {
            bridge.sleep(control().poll_interval_seconds)?;
        }
        let front = bridge.front_application("");
        let opened = self.open_popup(opener_tab_id, initial_url);
        if !front.is_empty() && bridge.front_application("") != front {
            bridge.front_application(&front);
        }
        opened
    }

    fn open_popup(&self, opener_tab_id: Option<&str>, initial_url: &str) -> BrowserResult<String> {
        let source = scripts::open_popup(initial_url);
        let tab_id = self
            .bridge
            .dispatch_navigation(
                scripts::OPEN_WORKER_WINDOW,
                &[opener_tab_id.unwrap_or_default().to_owned(), source],
                self.bridge.monotonic() + control().interaction_timeout_seconds,
            )?
            .trim()
            .to_owned();
        if !is_ascii_digits(&tab_id) {
            return Err(BrowserError::session(
                "Brave returned an invalid worker tab identity",
            ));
        }
        Ok(tab_id)
    }

    pub(super) fn close_settled_tab(&self, tab_id: &str) -> BrowserResult<()> {
        let mut session = BrowserInstagramSession::on_tab(&self.bridge, tab_id, true, None);
        match session.cancel_pending_request() {
            Ok(()) => {}
            Err(error) if error.is(SessionKind::TabUnavailable) => return Ok(()),
            // This surplus document is being destroyed, never reused or switched.
            // Closing its exact ID is the final cancellation boundary.
            Err(error)
                if error.is_session() && error.to_string().contains(CANCELLATION_UNCONFIRMED) => {}
            Err(error) => return Err(error),
        }
        let deadline = self.bridge.monotonic() + control().request_timeout_seconds;
        let runner = session
            .pinned_runner()
            .expect("the session runs on a pinned tab");
        let (tab, window) = match runner.pin_until(deadline) {
            Ok(identity) => identity,
            // Already closed.
            Err(error) if error.is(SessionKind::TabUnavailable) => return Ok(()),
            Err(error) => return Err(error),
        };
        self.bridge.close_owned_tab(&tab, &window)
    }

    pub(super) fn ready_username(session: &mut BrowserInstagramSession) -> BrowserResult<String> {
        let mut username: Option<String> = None;
        let read = session.poll_until(|session| {
            session.current_page_path(true)?;
            username = session.current_account_username()?;
            if username.is_none() && session.read(scripts::LOGGED_OUT)? == "true" {
                // A logged-out page never gains an identity; only a person can log in.
                // Checked on every poll: waiting first spends the budget.
                return Err(BrowserError::session(LOGGED_OUT_PAUSE));
            }
            Ok(username.is_some())
        });
        match read {
            Err(error) if error.is(SessionKind::PageUnavailable) => username = None,
            other => other?,
        }
        username.ok_or_else(|| {
            BrowserError::Timeout("Instagram account identity is temporarily unreadable".to_owned())
        })
    }

    /// The configured bootstrap profile: the caller's, the last verified, the oldest
    /// queued account's, then the configured school's. A stored value that is not a
    /// name fails where it is used, as Python's profile URL check did.
    fn bootstrap_username(&self, bootstrap_username: Option<&str>) -> BrowserResult<String> {
        if let Some(username) = bootstrap_username.filter(|username| !username.is_empty()) {
            return Ok(username.to_owned());
        }
        if let Some(stored) = self.queue.get_setting("retrieval_pool_account")?
            && pyjson::truthy(&stored)
        {
            return Ok(stored
                .as_str()
                .map_or_else(|| " ".to_owned(), str::to_owned));
        }
        if let Some(username) = self
            .queue
            .peek_account_username()?
            .filter(|username| !username.is_empty())
        {
            return Ok(username);
        }
        school_account_username(&control().bootstrap_profile_school).map_err(BrowserError::Value)
    }
}

impl TabPool for BrowserTabPool {
    fn ensure_capacity(&self, bootstrap_username: Option<&str>) -> BrowserResult<Vec<String>> {
        let registered = self.registered_ids()?;
        let mut ids = self.live_ids(&registered)?;
        let primary_lost = ids.is_empty() || ids[0] != registered[0];
        if ids != registered {
            self.save(&ids)?;
            if primary_lost {
                // A new primary must re-verify which account it shows.
                self.queue
                    .set_setting("retrieval_pool_account", Value::Null)?;
            }
        }
        let bootstrap_username = self.bootstrap_username(bootstrap_username)?;
        if primary_lost {
            // A lost primary is replaced first; a retrieval tab is never promoted.
            let opener = ids.first().cloned();
            let tab_id = self.open_window(
                opener.as_deref(),
                &account_profile_url(&bootstrap_username)?,
            )?;
            ids.insert(0, tab_id);
            self.save(&ids)?;
            self.pinned(&ids[0])
                .warm_viewport(control().interaction_timeout_seconds, false)?;
        }
        let surplus: Vec<String> = ids.iter().skip(control().parallel_tabs).cloned().collect();
        for tab_id in surplus {
            self.close_settled_tab(&tab_id)?;
            ids.retain(|id| *id != tab_id);
            self.save(&ids)?;
        }
        let mut primary = BrowserInstagramSession::on_tab(
            &self.bridge,
            &ids[0],
            true,
            Some(control().interaction_timeout_seconds),
        );
        let path = primary.current_page_path(false)?;
        let mut username = if path == "/" {
            None
        } else {
            primary.current_account_username()?
        };
        if username.is_none() {
            // Instagram's home endpoint can be a complete blank/error document while
            // public profiles still expose valid authenticated navigation.
            primary.navigate(&account_profile_url(&bootstrap_username)?, true)?;
            username = Some(Self::ready_username(&mut primary)?);
        }
        let profile_url = account_profile_url(username.as_deref().expect("username was read"))?;
        while ids.len() < control().parallel_tabs {
            let tab_id = self.open_window(Some(&ids[0].clone()), &profile_url)?;
            if ids.contains(&tab_id) {
                return Err(BrowserError::session(
                    "Brave returned an invalid worker tab identity",
                ));
            }
            ids.push(tab_id.clone());
            self.save(&ids)?;
            self.pinned(&tab_id)
                .warm_viewport(control().interaction_timeout_seconds, false)?;
        }
        Ok(ids)
    }

    fn settle_registered_tabs(&self) -> BrowserResult<Vec<BrowserInstagramSession>> {
        let mut sessions: Vec<BrowserInstagramSession> = self
            .registered_ids()?
            .iter()
            .enumerate()
            .map(|(index, tab_id)| {
                BrowserInstagramSession::on_tab(&self.bridge, tab_id, index == 0, None)
            })
            .collect();
        if sessions.is_empty() {
            return Err(BrowserError::tab_unavailable(
                "No worker Instagram window is open",
            ));
        }
        let mut failures: Vec<BrowserError> = Vec::new();
        let mut retired = false;
        for (index, session) in sessions.iter_mut().enumerate() {
            match session.cancel_pending_request() {
                Ok(()) => {}
                Err(error) if error.is(SessionKind::TabUnavailable) => return Err(error),
                Err(error) if error.is_session() => {
                    if index == 0 || !error.to_string().contains(CANCELLATION_UNCONFIRMED) {
                        failures.push(error);
                        continue;
                    }
                    match session.retire_unresponsive_read_tab() {
                        Err(retire_error) if retire_error.is_session() => failures.push(error),
                        Err(retire_error) => return Err(retire_error),
                        Ok(()) => retired = true,
                    }
                }
                Err(error) => return Err(error),
            }
        }
        if let Some(failure) = failures.into_iter().next() {
            return Err(failure);
        }
        if retired {
            return Err(BrowserError::tab_unavailable(
                "An unresponsive secondary Instagram tab was closed",
            ));
        }
        Ok(sessions)
    }

    fn recover_login(&self) -> BrowserResult<String> {
        let ids = self.live_ids(&self.registered_ids()?)?;
        if ids.is_empty() {
            return Err(BrowserError::tab_unavailable(
                "No worker Instagram window is open",
            ));
        }
        let mut session = BrowserInstagramSession::on_tab(
            &self.bridge,
            &ids[0],
            true,
            Some(control().login_recovery_timeout_seconds),
        );
        // Instagram's home page lists the saved profiles when logged out.
        session.run(&scripts::assign_home())?;
        let preferred = self
            .queue
            .get_setting("retrieval_pool_account")?
            .unwrap_or(Value::Null);
        let mut clicked: Vec<String> = Vec::new();
        let mut outcome: Option<String> = Some(String::new());
        session.poll_until(|session| {
            let Ok(page) = serde_json::from_str::<Value>(&session.read(scripts::LOGIN_PAGE)?)
            else {
                return Ok(false);
            };
            let Value::Object(page) = page else {
                return Err(BrowserError::other(
                    "AttributeError",
                    "Instagram login page state is not an object",
                ));
            };
            outcome = match page.get("state") {
                None => Some(String::new()),
                Some(Value::String(state)) => Some(state.clone()),
                Some(_) => None,
            };
            match outcome.as_deref() {
                Some("logged_in" | "password" | "challenge") => return Ok(true),
                // Keeps one-tap login available; logged in either way.
                Some("save_info") => {
                    session.run(&scripts::click_label("Save info"))?;
                    return Ok(true);
                }
                Some("profiles") if clicked.is_empty() => {}
                _ => return Ok(false),
            }
            let listed = match page.get("profiles") {
                None => Vec::new(),
                Some(Value::Array(profiles)) => profiles.clone(),
                Some(Value::String(_)) => Vec::new(),
                Some(_) => {
                    return Err(BrowserError::other(
                        "TypeError",
                        "Instagram login profiles are not a list",
                    ));
                }
            };
            let mut profiles = Vec::new();
            for profile in listed {
                let Value::String(profile) = profile else {
                    return Err(BrowserError::other(
                        "TypeError",
                        "Instagram login profile is not a name",
                    ));
                };
                if WAT2DO_ACCOUNT_PATTERN.is_match(&profile) {
                    profiles.push(profile);
                }
            }
            if let Some(first) = profiles.first() {
                let choice = preferred
                    .as_str()
                    .filter(|preferred| profiles.iter().any(|profile| profile == preferred))
                    .unwrap_or(first)
                    .to_owned();
                if session.run(&scripts::click_label(&choice))? == "clicked" {
                    clicked.push(choice);
                }
            }
            Ok(false)
        })?;
        if outcome.as_deref() == Some("password") {
            // The saved profile clicked, or the preferred account on a bare login form.
            let shown = clicked
                .first()
                .cloned()
                .unwrap_or_else(|| pyjson::str(&preferred));
            let username = account_login::canonical_account(&shown);
            let Some(password) = account_login::account_password(&self.bridge, &username) else {
                return Err(BrowserError::session(format!(
                    "Instagram needs a person: no stored password for {username}"
                )));
            };
            // A password goes to Instagram at most once a day per account, and within
            // the day's total of account logins.
            if !self
                .queue
                .reserve_account_login(&username, self.bridge.time())?
            {
                return Err(BrowserError::session(format!(
                    "Instagram needs a person: {username}'s password was already entered today, or today's account logins are used up"
                )));
            }
            session.log_in(&username, &password)?;
            outcome = Some("logged_in".to_owned());
        }
        if outcome.as_deref() == Some("challenge") {
            return Err(BrowserError::session(
                "Instagram needs a person: it asks to confirm the account",
            ));
        }
        let mut username: Option<String> = None;
        session.poll_until(|session| {
            username = session.current_account_username()?;
            Ok(username.is_some())
        })?;
        self.queue
            .set_setting("retrieval_pool_account", Value::Null)?;
        // Other worker windows still show the logged-out page until reloaded.
        for tab_id in &ids[1..] {
            match self
                .pinned(tab_id)
                .run(scripts::RELOAD, control().request_timeout_seconds)
            {
                // The pool check repairs a window that cannot reload.
                Err(error) if error.is_session() => {}
                Err(error) => return Err(error),
                Ok(_) => {}
            }
        }
        Ok(username.expect("identified before returning"))
    }

    fn add_account(&self, username: &str) -> BrowserResult<()> {
        let Some(password) = account_login::account_password(&self.bridge, username) else {
            return Err(BrowserError::session(format!(
                "Instagram needs a person: no stored password for {username}"
            )));
        };
        let ids = self.live_ids(&self.registered_ids()?)?;
        if ids.is_empty() {
            return Err(BrowserError::tab_unavailable(
                "No worker Instagram window is open",
            ));
        }
        let mut session = BrowserInstagramSession::on_tab(
            &self.bridge,
            &ids[0],
            true,
            Some(control().login_recovery_timeout_seconds),
        );
        let from_account =
            school_account_username(&control().login_from_school).map_err(BrowserError::Value)?;
        session.add_account(username, &password, &from_account)
    }

    fn prepare(
        &self,
        job: &BrowserJob,
        count: usize,
    ) -> BrowserResult<(Vec<BrowserInstagramSession>, String)> {
        if count < 1 {
            return Err(BrowserError::Value(
                "Worker tab batch exceeds its configured capacity".to_owned(),
            ));
        }
        self.ensure_capacity(Some(&job.account_username))?;
        let mut sessions = self.settle_registered_tabs()?;
        let primary = &mut sessions[0];
        let logged_out = match primary.read(scripts::SERVER_LOGIN) {
            Ok(state) => state == "logged_out",
            // Unknown; the job's own requests will tell.
            Err(error)
                if error.is(SessionKind::AutomationTransient)
                    || error.is(SessionKind::PageUnavailable) =>
            {
                false
            }
            Err(error) => return Err(error),
        };
        if logged_out {
            return Err(BrowserError::session(LOGGED_OUT_PAUSE));
        }
        let username = if job.kind == "digest" {
            primary.activate_account(&job.recipient_id, &job.account_username)?
        } else {
            Self::ready_username(primary)?
        };
        let mut secondary: Vec<BrowserInstagramSession> = sessions.into_iter().skip(1).collect();
        if secondary.is_empty() {
            return Err(BrowserError::session(
                "No secondary Instagram tab is available for browser requests",
            ));
        }
        let count = if job.kind == "retrieval" {
            secondary.len()
        } else {
            count.min(secondary.len())
        };
        secondary.truncate(count);
        for session in &mut secondary {
            session.reset_job_deadline(control().job_timeout_seconds);
        }
        // Digest requests need refreshed identity after their serialized switch.
        // Public retrievals own navigation and readiness on each assigned target.
        if job.kind == "digest" {
            for session in &mut secondary {
                session.navigate(&account_profile_url(&username)?, true)?;
            }
        }
        if job.kind == "retrieval" {
            // Retain only a verified public-profile bootstrap hint for repairs.
            self.queue
                .set_setting("retrieval_pool_account", Value::from(username.clone()))?;
        }
        Ok((secondary, username))
    }
}
