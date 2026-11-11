//! Lightpanda, a light headless browser, reading Instagram digests and Following lists
//! for the school accounts beside Brave.
//!
//! Each account has its own owner-only cookie jar in the worker's state directory and
//! its own `lightpanda serve` process, driven over CDP on an owner-only Unix socket,
//! with at most `max_sessions` of them running on the Mac at once ([`Lease`]). The
//! worker logs accounts in itself with the Keychain passwords and the emailed codes
//! ([`login`], through the Brave worker's Keychain and Gmail reader and its daily login
//! budget), one more at most every `ramp_interval_minutes` ([`ramp`]). The worker's
//! [`lane`] reads digests (once `instagram_digest.json`'s `digest_engine` says
//! `"lightpanda"`) and Following lists in those sessions with the Brave worker's own
//! queries and checks ([`digest`], [`following`]); [`shadow`] replays the digests Brave
//! resolved and compares the media IDs.

pub mod browser;
pub mod cdp;
pub mod digest;
pub mod following;
pub mod install;
pub mod jar;
pub mod lane;
pub mod login;
pub mod ramp;
pub mod scripts;
pub mod shadow;

use std::fs::File;
use std::path::{Path, PathBuf};

use anyhow::{Context, bail};
use fs2::FileExt;

use crate::controlbox::INSTAGRAM_LIGHTPANDA as CONTROL;
use crate::instagram_notifications::browser_queue::default_state_directory;
use browser::Browser;
use jar::CookieJar;

pub const HOME_URL: &str = "https://www.instagram.com/";

/// The pinned binary and the accounts' jars.
pub struct Lightpanda {
    binary: PathBuf,
    jars: PathBuf,
}

/// What one open Lightpanda holds while it runs: its account, so no two processes
/// drive the same jar, and one of the Mac's `max_sessions` places.
pub struct Lease {
    _account: File,
    _slot: File,
}

impl Lightpanda {
    /// The installed binary, checked against the pin, with the jars in the worker's
    /// state directory.
    pub async fn installed() -> anyhow::Result<Self> {
        Self::installed_with_jars(jars_directory()).await
    }

    /// The installed binary, checked against the pin, with the jars in `jars`.
    pub async fn installed_with_jars(jars: PathBuf) -> anyhow::Result<Self> {
        let binary = install::checked_binary(install::binary_path()).await?;
        Self::new(binary, jars)
    }

    fn new(binary: PathBuf, jars: PathBuf) -> anyhow::Result<Self> {
        jar::create_directory(&jars)?;
        Ok(Self { binary, jars })
    }

    pub fn jar(&self, account: &str) -> anyhow::Result<CookieJar> {
        CookieJar::for_account(&self.jars, account)
    }

    /// The accounts whose jar holds a login, in name order.
    pub fn logged_in_accounts(&self) -> anyhow::Result<Vec<String>> {
        logged_in_accounts(&self.jars)
    }

    /// Take `account` and a free session place, or fail without waiting.
    pub fn lease(&self, account: &str) -> anyhow::Result<Lease> {
        lease(&self.jars, account, CONTROL.max_sessions)
    }

    /// Start Lightpanda with `account`'s jar and open Instagram.
    pub async fn open(&self, account: &str) -> anyhow::Result<Browser> {
        let lease = self.lease(account)?;
        let mut browser = Browser::launch(&self.binary, self.jar(account)?, lease).await?;
        if let Err(error) = browser.navigate(HOME_URL).await {
            let _ = browser.close().await;
            return Err(error);
        }
        Ok(browser)
    }
}

/// Where the worker keeps the accounts' Lightpanda jars.
pub fn jars_directory() -> PathBuf {
    jars_in(&default_state_directory())
}

/// The jars beside the worker's queue in `state_directory`.
pub fn jars_in(state_directory: &Path) -> PathBuf {
    state_directory.join("lightpanda")
}

/// The accounts in `jars` whose jar holds a login, in name order.
pub fn logged_in_accounts(jars: &Path) -> anyhow::Result<Vec<String>> {
    let mut accounts = Vec::new();
    let entries = match std::fs::read_dir(jars) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(accounts),
        Err(error) => return Err(error).context("the Lightpanda jars could not be listed"),
    };
    for entry in entries {
        let name = entry?.file_name();
        let Some(account) = name
            .to_str()
            .and_then(|name| name.strip_suffix(".json"))
            .filter(|account| !account.ends_with(".next"))
        else {
            continue;
        };
        if CookieJar::for_account(jars, account).is_ok_and(|jar| jar.holds_session()) {
            accounts.push(account.to_owned());
        }
    }
    accounts.sort();
    Ok(accounts)
}

/// Take `account`'s lock and one of `places` session places under `jars`.
fn lease(jars: &Path, account: &str, places: usize) -> anyhow::Result<Lease> {
    // The jar's name check also keeps the lock file's name safe.
    CookieJar::for_account(jars, account)?;
    let locks = jars.join("locks");
    jar::create_directory(&locks)?;
    let try_lock = |name: String| -> anyhow::Result<Option<File>> {
        let path = locks.join(name);
        let file = File::create(&path)
            .with_context(|| format!("{} could not be opened", path.display()))?;
        Ok(file.try_lock_exclusive().is_ok().then_some(file))
    };
    let Some(account_lock) = try_lock(format!("{account}.lock"))? else {
        bail!("another wat2do process is driving {account}'s Lightpanda");
    };
    for place in 0..places {
        if let Some(slot) = try_lock(format!("session-{place}.lock"))? {
            return Ok(Lease {
                _account: account_lock,
                _slot: slot,
            });
        }
    }
    bail!("all {places} Lightpanda sessions are in use")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_jar(directory: &Path, account: &str, session: &str) {
        let cookies = serde_json::json!([{"name": "sessionid", "value": session}]);
        std::fs::write(
            directory.join(format!("{account}.json")),
            cookies.to_string(),
        )
        .unwrap();
    }

    #[test]
    fn only_jars_holding_a_login_are_logged_in_accounts() {
        let jars = tempfile::tempdir().unwrap();
        write_jar(jars.path(), "wat2do.sfu", "fixture");
        write_jar(jars.path(), "wat2do.mun", "fixture");
        write_jar(jars.path(), "wat2do.ubc", "");
        write_jar(jars.path(), "wat2do.mun.next", "fixture");
        std::fs::write(jars.path().join("wat2do.ualberta.lock"), "").unwrap();
        assert_eq!(
            logged_in_accounts(jars.path()).unwrap(),
            ["wat2do.mun", "wat2do.sfu"]
        );
        assert!(
            logged_in_accounts(&jars.path().join("missing"))
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn a_lease_holds_its_account_and_one_of_the_places() {
        let jars = tempfile::tempdir().unwrap();
        let first = lease(jars.path(), "wat2do.mun", 2).unwrap();
        let same = lease(jars.path(), "wat2do.mun", 2);
        assert!(same.err().unwrap().to_string().contains("wat2do.mun"));
        let second = lease(jars.path(), "wat2do.sfu", 2).unwrap();
        let full = lease(jars.path(), "wat2do.ubc", 2);
        assert!(full.err().unwrap().to_string().contains("all 2"));
        drop(first);
        let _third = lease(jars.path(), "wat2do.ubc", 2).unwrap();
        drop(second);
        assert!(lease(jars.path(), "../escape", 2).is_err());
    }
}
