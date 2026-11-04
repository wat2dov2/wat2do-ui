//! JavaScript in one exact worker tab, pinned once and never silently replaced.

use std::sync::Arc;

use serde_json::Value;

use super::super::errors::{BrowserError, BrowserResult, SessionKind};
use super::super::scripts;
use super::bridge::{Bridge, TAB_CLOSED, is_ascii_digits};
use crate::controlbox::instagram_browser as control;

/// Python's `JavascriptRunner`: run a source in a page within `timeout` seconds.
/// Only a pinned Brave tab also navigates, warms its viewport and takes secrets.
pub trait JavascriptRunner: Send {
    fn run(&mut self, source: &str, timeout: f64) -> BrowserResult<String>;

    /// Native navigation; `None` when this runner cannot navigate.
    fn navigate(
        &mut self,
        _url: &str,
        _timeout: f64,
        _reload: bool,
    ) -> Option<BrowserResult<String>> {
        None
    }

    /// The pinned Brave tab behind this runner, if it is one.
    fn pinned(&mut self) -> Option<&mut PinnedRunner> {
        None
    }
}

/// `_PinnedBraveJavascriptRunner`: pin one existing tab once.
pub struct PinnedRunner {
    bridge: Arc<Bridge>,
    pub(crate) tab_id: Option<String>,
    pub(crate) window_id: Option<String>,
    pub(crate) viewport_ready: bool,
}

impl PinnedRunner {
    pub fn new(bridge: Arc<Bridge>, tab_id: Option<String>) -> Self {
        Self {
            bridge,
            tab_id,
            window_id: None,
            viewport_ready: false,
        }
    }

    pub fn tab(bridge: &Arc<Bridge>, tab_id: &str) -> Self {
        Self::new(bridge.clone(), Some(tab_id.to_owned()))
    }

    fn execute(
        &mut self,
        source: &str,
        tab_id: &str,
        window_id: &str,
        deadline: f64,
    ) -> BrowserResult<String> {
        loop {
            match self.execute_once(source, tab_id, window_id, deadline) {
                // Native loading is checked before execute. No source ran yet, so
                // waiting here cannot replay a query or engagement click.
                Err(error) if error.is(SessionKind::PageUnavailable) => {
                    let wait = control()
                        .poll_interval_seconds
                        .min(self.bridge.time_left(deadline)?);
                    self.bridge.sleep(wait)?;
                }
                other => return other,
            }
        }
    }

    fn execute_once(
        &mut self,
        source: &str,
        tab_id: &str,
        window_id: &str,
        deadline: f64,
    ) -> BrowserResult<String> {
        let arguments = [tab_id.to_owned(), source.to_owned(), window_id.to_owned()];
        let result = self.bridge.time_left(deadline).and_then(|timeout| {
            self.bridge
                .run_applescript(scripts::EXECUTE_TAB, &arguments, timeout, false)
        });
        result.map_err(|error| self.verify_closed_document(error, deadline))
    }

    /// Run a source holding a password: it is written into the script on stdin.
    pub fn run_secret(&mut self, source: &str, timeout: f64) -> BrowserResult<String> {
        let deadline = self.bridge.monotonic() + timeout;
        let (tab_id, window_id) = self.pin(deadline)?;
        let script = scripts::execute_tab_with_source(source);
        self.bridge.run_applescript(
            &script,
            &[tab_id, String::new(), window_id],
            self.bridge.time_left(deadline)?,
            true,
        )
    }

    fn viewport_is_ready(
        &mut self,
        tab_id: &str,
        window_id: &str,
        deadline: f64,
        minimum_width: u32,
    ) -> BrowserResult<bool> {
        let raw = self.execute_once(scripts::VIEWPORT, tab_id, window_id, deadline)?;
        let invalid = || BrowserError::session("Instagram browser returned invalid viewport state");
        let viewport: Value = serde_json::from_str(raw.trim()).map_err(|_| invalid())?;
        let Value::Object(viewport) = viewport else {
            return Err(invalid());
        };
        let (Some(Value::Number(width)), Some(Value::Number(height))) =
            (viewport.get("width"), viewport.get("height"))
        else {
            return Err(invalid());
        };
        let (width, height) = (
            width.as_f64().unwrap_or(0.0),
            height.as_f64().unwrap_or(0.0),
        );
        Ok(width > 0.0 && width >= f64::from(minimum_width) && height > 0.0)
    }

    /// Lay out the tab by briefly activating it; Brave may stay in the background.
    pub fn warm_viewport(&mut self, timeout: f64, primary: bool) -> BrowserResult<()> {
        let bridge = self.bridge.clone();
        let deadline = bridge.monotonic() + timeout;
        let (tab_id, window_id) = self.pin(deadline)?;
        let minimum_width = if primary {
            control().primary_minimum_viewport_width
        } else {
            0
        };
        self.viewport_ready = false;
        let probe_deadline = bridge.monotonic()
            + control()
                .viewport_warm_timeout_seconds
                .min(bridge.time_left(deadline)?);
        match self.viewport_is_ready(&tab_id, &window_id, probe_deadline, minimum_width) {
            Ok(true) => {
                self.viewport_ready = true;
                return Ok(());
            }
            Ok(false) => {}
            Err(error)
                if error.is(SessionKind::AutomationTransient)
                    || error.is(SessionKind::PageUnavailable) => {}
            Err(error) => return Err(error),
        }
        let mut last_error: Option<BrowserError> = None;
        loop {
            let remaining = deadline - bridge.monotonic();
            if remaining <= 0.0 {
                if let Some(error) = last_error {
                    return Err(error);
                }
                return Err(BrowserError::page_unavailable(if primary {
                    "Instagram primary desktop viewport did not become ready"
                } else {
                    "Instagram browser viewport did not become ready"
                }));
            }
            let transport = bridge.lock_transport(remaining)?;
            let transaction_started = bridge.monotonic();
            let transaction_deadline = transaction_started
                + control()
                    .viewport_warm_timeout_seconds
                    .min((deadline - transaction_started).max(0.0));
            let sample_deadline =
                transaction_started + (transaction_deadline - transaction_started) / 2.0;
            let mut previous_id = String::new();
            let mut ready = false;
            let attempt: BrowserResult<()> = (|| {
                previous_id = bridge
                    .run_applescript(
                        scripts::ACTIVATE_TAB,
                        &[tab_id.clone(), window_id.clone(), minimum_width.to_string()],
                        bridge.time_left(sample_deadline)?,
                        false,
                    )?
                    .trim()
                    .to_owned();
                if !is_ascii_digits(&previous_id) {
                    return Err(BrowserError::session(
                        "Brave returned an invalid active tab identity",
                    ));
                }
                ready =
                    self.viewport_is_ready(&tab_id, &window_id, sample_deadline, minimum_width)?;
                Ok(())
            })();
            let outcome = match attempt {
                Ok(()) => {
                    last_error = None;
                    Ok(())
                }
                Err(error)
                    if error.is(SessionKind::AutomationTransient)
                        || error.is(SessionKind::PageUnavailable) =>
                {
                    last_error = Some(error);
                    Ok(())
                }
                Err(error) => Err(error),
            };
            let restored = if previous_id.is_empty() {
                Ok(String::new())
            } else {
                bridge.time_left(transaction_deadline).and_then(|timeout| {
                    bridge.run_applescript(
                        scripts::RESTORE_ACTIVE_TAB,
                        &[tab_id.clone(), previous_id.clone(), window_id.clone()],
                        timeout,
                        false,
                    )
                })
            };
            drop(transport);
            // A failed restoration replaces the transaction's own outcome, as in Python's finally.
            restored?;
            outcome?;
            if ready {
                self.viewport_ready = true;
                return Ok(());
            }
            let remaining = deadline - bridge.monotonic();
            // Activation, one sample and restoration are atomic. Page waits are outside
            // that transaction so other tabs can use the transport.
            if remaining > 0.0 {
                bridge.sleep(control().poll_interval_seconds.min(remaining))?;
            }
        }
    }

    fn pin(&mut self, deadline: f64) -> BrowserResult<(String, String)> {
        let Some(tab_id) = self.tab_id.clone() else {
            // Worker windows are opened by BrowserTabPool; a person's own Instagram
            // tabs are never adopted.
            return Err(BrowserError::tab_unavailable(
                "No worker Instagram window is open",
            ));
        };
        if self.window_id.is_none() {
            let window_id = self
                .bridge
                .read_applescript(
                    scripts::WORKER_WINDOW,
                    std::slice::from_ref(&tab_id),
                    self.bridge.time_left(deadline)?,
                )?
                .trim()
                .to_owned();
            if !is_ascii_digits(&window_id) {
                return Err(BrowserError::session(
                    "Brave returned an invalid worker window identity",
                ));
            }
            self.window_id = Some(window_id);
        }
        Ok((
            tab_id,
            self.window_id.clone().expect("window was just pinned"),
        ))
    }

    /// Public for the tab pool, which closes a surplus tab by its exact identity.
    pub(crate) fn pin_until(&mut self, deadline: f64) -> BrowserResult<(String, String)> {
        self.pin(deadline)
    }

    /// `_verify_closed_document`: the error to raise for a failure of this tab.
    fn verify_closed_document(&mut self, error: BrowserError, deadline: f64) -> BrowserError {
        if !error.is_session() || error.to_string() != TAB_CLOSED {
            return error;
        }
        let tab_id = self.tab_id.clone().expect("a pinned tab has an identity");
        // One native proof also serves atomic viewport sampling; retries belong to the
        // surrounding read owner after transport release.
        let located = self.bridge.time_left(deadline).and_then(|timeout| {
            self.bridge
                .run_applescript(scripts::WORKER_WINDOW, &[tab_id], timeout, false)
        });
        match located {
            Err(location_error) if location_error.is_session() => {
                if location_error.to_string() == TAB_CLOSED {
                    error
                } else {
                    location_error
                }
            }
            Err(other) => other,
            Ok(_) => BrowserError::tab_unavailable("The worker Instagram tab left its window"),
        }
    }
}

impl JavascriptRunner for PinnedRunner {
    fn run(&mut self, source: &str, timeout: f64) -> BrowserResult<String> {
        let deadline = self.bridge.monotonic() + timeout;
        let (tab_id, window_id) = self.pin(deadline)?;
        if !self.viewport_ready {
            let timeout = self.bridge.time_left(deadline)?;
            self.warm_viewport(timeout, false)?;
        }
        self.execute(source, &tab_id, &window_id, deadline)
    }

    fn navigate(&mut self, url: &str, timeout: f64, reload: bool) -> Option<BrowserResult<String>> {
        let deadline = self.bridge.monotonic() + timeout;
        let result = (|| {
            let (tab_id, window_id) = self.pin(deadline)?;
            let arguments = [
                tab_id,
                url.to_owned(),
                window_id,
                if reload { "true" } else { "false" }.to_owned(),
                scripts::navigation(url),
            ];
            let result = self
                .bridge
                .dispatch_navigation(scripts::NAVIGATE_TAB, &arguments, deadline)
                .map_err(|error| self.verify_closed_document(error, deadline))?;
            if result.trim() == "navigating" {
                self.viewport_ready = false;
            }
            Ok(result)
        })();
        Some(result)
    }

    fn pinned(&mut self) -> Option<&mut PinnedRunner> {
        Some(self)
    }
}
