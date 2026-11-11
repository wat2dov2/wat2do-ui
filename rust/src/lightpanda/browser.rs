//! One `lightpanda serve` process per account: started with that account's cookie
//! jar, driven through one page over CDP, and shut down so the jar is saved.

use std::path::Path;
use std::process::Stdio;
use std::time::{Duration, Instant};

use anyhow::{Context, bail};
use serde_json::{Value, json};
use tokio::process::{Child, Command};
use tokio::sync::broadcast::error::RecvError;

use super::Lease;
use super::cdp::{Cdp, CdpError};
use super::jar::{CookieJar, SESSION_COOKIE, holds_login};
use crate::controlbox::INSTAGRAM_LIGHTPANDA as CONTROL;

/// Short CDP commands (target and input bookkeeping) answer within this.
const COMMAND_TIMEOUT: Duration = Duration::from_secs(10);

fn seconds(value: f64) -> Duration {
    Duration::from_secs_f64(value.max(0.0))
}

/// A running Lightpanda with one page open in its own browser context.
pub struct Browser {
    child: Child,
    cdp: Cdp,
    jar: CookieJar,
    context_id: String,
    target_id: String,
    session_id: String,
    peak_rss_kib: u64,
    /// The account and the session place, with the place's socket directory, all
    /// released when the browser is dropped.
    _lease: Lease,
}

impl Browser {
    /// Start Lightpanda with the account's jar and open a blank page.
    pub async fn launch(binary: &Path, jar: CookieJar, lease: Lease) -> anyhow::Result<Self> {
        // Beside the jars: owner-only, and short enough for a socket path.
        let socket = lease.runtime_directory()?.join("cdp.sock");
        let mut command = Command::new(binary);
        command
            .arg("serve")
            .arg("--unix-socket")
            .arg(&socket)
            .arg("--disable-metrics")
            .arg("--log-level")
            .arg("error");
        if let Some(saved) = jar.saved() {
            command.arg("--cookie").arg(saved);
        }
        command
            .arg("--cookie-jar")
            .arg(jar.next_path())
            .env("LIGHTPANDA_DISABLE_TELEMETRY", "true")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            // Lightpanda's own log can name the pages it loads; it is not kept.
            .stderr(Stdio::null())
            .kill_on_drop(true);
        let mut child = command.spawn().context("Lightpanda did not start")?;
        let cdp = match connect(&socket, seconds(CONTROL.startup_timeout_seconds)).await {
            Ok(cdp) => cdp,
            Err(error) => {
                let _ = child.kill().await;
                return Err(error);
            }
        };
        let (context_id, target_id, session_id) = match open_page(&cdp).await {
            Ok(page) => page,
            Err(error) => {
                let _ = child.kill().await;
                return Err(error.into());
            }
        };
        let mut browser = Self {
            child,
            cdp,
            jar,
            context_id,
            target_id,
            session_id,
            peak_rss_kib: 0,
            _lease: lease,
        };
        browser.sample_memory();
        Ok(browser)
    }

    /// Load `url` and wait for its load event.
    pub async fn navigate(&mut self, url: &str) -> anyhow::Result<()> {
        let timeout = seconds(CONTROL.navigation_timeout_seconds);
        let mut events = self.cdp.events();
        self.call("Page.navigate", json!({"url": url}), timeout)
            .await?;
        let deadline = tokio::time::Instant::now() + timeout;
        loop {
            match tokio::time::timeout_at(deadline, events.recv()).await {
                Ok(Ok(event))
                    if event.method == "Page.loadEventFired"
                        && event.session_id.as_deref() == Some(self.session_id.as_str()) =>
                {
                    break;
                }
                Ok(Ok(_) | Err(RecvError::Lagged(_))) => continue,
                Ok(Err(RecvError::Closed)) => return Err(CdpError::Closed.into()),
                Err(_) => bail!("Lightpanda did not finish loading the page in time"),
            }
        }
        self.sample_memory();
        Ok(())
    }

    /// Type `text` into the focused field the way a keyboard would.
    pub async fn insert_text(&mut self, text: &str) -> anyhow::Result<()> {
        self.call("Input.insertText", json!({"text": text}), COMMAND_TIMEOUT)
            .await?;
        Ok(())
    }

    /// Press and release Enter in the focused field.
    pub async fn press_enter(&mut self) -> anyhow::Result<()> {
        for kind in ["keyDown", "keyUp"] {
            let mut key = json!({
                "type": kind, "key": "Enter", "code": "Enter", "windowsVirtualKeyCode": 13
            });
            if kind == "keyDown" {
                key["text"] = json!("\r");
            }
            self.call("Input.dispatchKeyEvent", key, COMMAND_TIMEOUT)
                .await?;
        }
        Ok(())
    }

    /// Whether the browser holds a non-empty Instagram session cookie.
    pub async fn has_session(&mut self) -> anyhow::Result<bool> {
        let reply = self
            .call(
                "Network.getCookies",
                json!({"urls": [super::HOME_URL]}),
                COMMAND_TIMEOUT,
            )
            .await?;
        let cookies = reply.get("cookies").and_then(Value::as_array);
        Ok(cookies.is_some_and(|cookies| holds_login(cookies)))
    }

    /// The Instagram user ID the page is logged in as (its `ds_user_id` cookie, which
    /// names the account and grants nothing), or None when it is logged out.
    pub async fn user_id(&mut self) -> anyhow::Result<Option<String>> {
        let id = self.evaluate(super::scripts::USER_ID).await?;
        Ok(id
            .as_str()
            .and_then(|id| crate::schools::validate_recipient_id(id).ok()))
    }

    /// Forget the session cookie, so a login starts from the device cookies alone.
    pub async fn delete_session(&mut self) -> anyhow::Result<()> {
        for domain in [".instagram.com", "www.instagram.com"] {
            self.call(
                "Network.deleteCookies",
                json!({"name": SESSION_COOKIE, "domain": domain}),
                COMMAND_TIMEOUT,
            )
            .await?;
        }
        Ok(())
    }

    /// The most memory the Lightpanda process was seen holding so far, in KiB,
    /// including now.
    pub fn peak_rss_kib(&mut self) -> u64 {
        self.sample_memory();
        self.peak_rss_kib
    }

    /// Close the page and its context (Lightpanda saves the jar then), stop the
    /// process, and keep the saved cookies when they are worth keeping.
    pub async fn close(mut self) -> anyhow::Result<()> {
        self.sample_memory();
        let target = self
            .cdp
            .call(
                None,
                "Target.closeTarget",
                json!({"targetId": self.target_id}),
                COMMAND_TIMEOUT,
            )
            .await;
        // Disposed even when the page did not close: this is what saves the jar.
        let context = self
            .cdp
            .call(
                None,
                "Target.disposeBrowserContext",
                json!({"browserContextId": self.context_id}),
                COMMAND_TIMEOUT,
            )
            .await;
        self.cdp.close().await;
        stop(&mut self.child, seconds(CONTROL.shutdown_timeout_seconds)).await;
        let kept = self.jar.keep_next();
        target
            .and(context)
            .context("Lightpanda did not close its page")?;
        kept
    }

    fn sample_memory(&mut self) {
        if let Some(rss) = self.child.id().and_then(rss_kib) {
            self.peak_rss_kib = self.peak_rss_kib.max(rss);
        }
    }

    async fn call(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, CdpError> {
        self.cdp
            .call(Some(&self.session_id), method, params, timeout)
            .await
    }
}

/// A page that runs wat2do's scripts: Lightpanda's, or a stand-in in tests.
pub trait Page {
    /// Evaluate `expression`, awaiting a promise, and return its JSON value. A thrown
    /// exception is an error that names neither the expression nor the page.
    fn evaluate(&mut self, expression: &str) -> impl Future<Output = anyhow::Result<Value>>;
}

impl Page for Browser {
    async fn evaluate(&mut self, expression: &str) -> anyhow::Result<Value> {
        let reply = self
            .call(
                "Runtime.evaluate",
                json!({"expression": expression, "returnByValue": true, "awaitPromise": true}),
                seconds(CONTROL.navigation_timeout_seconds),
            )
            .await?;
        if reply.get("exceptionDetails").is_some() {
            bail!("the page threw while running a wat2do script");
        }
        Ok(reply
            .get("result")
            .and_then(|result| result.get("value"))
            .cloned()
            .unwrap_or(Value::Null))
    }
}

/// Wait for the socket to accept, then open the WebSocket.
async fn connect(socket: &Path, timeout: Duration) -> anyhow::Result<Cdp> {
    let started = Instant::now();
    loop {
        if socket.exists()
            && let Ok(cdp) = Cdp::connect_unix(socket).await
        {
            return Ok(cdp);
        }
        if started.elapsed() >= timeout {
            bail!("Lightpanda did not open its CDP socket in time");
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

/// A fresh browser context with one blank page, attached in flat mode.
async fn open_page(cdp: &Cdp) -> Result<(String, String, String), CdpError> {
    let text = |value: &Value, key: &str| {
        value
            .get(key)
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or(CdpError::Closed)
    };
    let context = cdp
        .call(
            None,
            "Target.createBrowserContext",
            json!({}),
            COMMAND_TIMEOUT,
        )
        .await?;
    let context_id = text(&context, "browserContextId")?;
    let target = cdp
        .call(
            None,
            "Target.createTarget",
            json!({"url": "about:blank", "browserContextId": context_id}),
            COMMAND_TIMEOUT,
        )
        .await?;
    let target_id = text(&target, "targetId")?;
    let attached = cdp
        .call(
            None,
            "Target.attachToTarget",
            json!({"targetId": target_id, "flatten": true}),
            COMMAND_TIMEOUT,
        )
        .await?;
    let session_id = text(&attached, "sessionId")?;
    for method in ["Page.enable", "Runtime.enable", "Network.enable"] {
        cdp.call(Some(&session_id), method, json!({}), COMMAND_TIMEOUT)
            .await?;
    }
    Ok((context_id, target_id, session_id))
}

/// Ask the process to exit; kill it when it does not in time.
async fn stop(child: &mut Child, timeout: Duration) {
    if let Some(pid) = child.id() {
        let _ = Command::new("/bin/kill")
            .arg("-TERM")
            .arg(pid.to_string())
            .status()
            .await;
    }
    if tokio::time::timeout(timeout, child.wait()).await.is_err() {
        let _ = child.kill().await;
    }
}

/// The resident memory of `pid` in KiB, as `ps` reports it.
fn rss_kib(pid: u32) -> Option<u64> {
    let output = std::process::Command::new("/bin/ps")
        .args(["-o", "rss=", "-p", &pid.to_string()])
        .output()
        .ok()?;
    String::from_utf8_lossy(&output.stdout).trim().parse().ok()
}
