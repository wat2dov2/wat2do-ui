//! Lightpanda, a light headless browser, reading Instagram digests for the school
//! accounts in place of Brave.
//!
//! Each account has its own owner-only cookie jar in the worker's state directory and
//! its own short-lived `lightpanda serve` process, driven over CDP on an owner-only
//! Unix socket. The worker logs accounts in itself with the Keychain passwords and
//! the emailed codes ([`login`], through the Brave worker's Keychain and Gmail reader
//! and its daily login budget), and resolves a digest with the Brave worker's own
//! query and checks ([`digest`]). Until `instagram_digest.json`'s `digest_engine` says
//! `"lightpanda"`, Lightpanda only runs in [`shadow`] mode: it replays the digests
//! Brave resolved and compares the media IDs.

pub mod browser;
pub mod cdp;
pub mod digest;
pub mod install;
pub mod jar;
pub mod login;
pub mod scripts;
pub mod shadow;

use std::fs::File;
use std::path::PathBuf;

use anyhow::Context;
use fs2::FileExt;

use crate::instagram_notifications::browser_queue::default_state_directory;
use browser::Browser;
use jar::CookieJar;

pub const HOME_URL: &str = "https://www.instagram.com/";

/// The pinned binary and the accounts' jars.
pub struct Lightpanda {
    binary: PathBuf,
    jars: PathBuf,
    /// Held while this process drives Lightpanda: one account at a time on the Mac.
    _lock: File,
}

impl Lightpanda {
    /// The installed binary, checked against the pin, with the jars in the worker's
    /// state directory. Fails while another process holds Lightpanda.
    pub async fn installed() -> anyhow::Result<Self> {
        let binary = install::checked_binary(install::binary_path()).await?;
        let jars = default_state_directory().join("lightpanda");
        Self::new(binary, jars)
    }

    fn new(binary: PathBuf, jars: PathBuf) -> anyhow::Result<Self> {
        jar::create_directory(&jars)?;
        let lock_path = jars.join("lightpanda.lock");
        let lock = File::create(&lock_path)
            .with_context(|| format!("{} could not be opened", lock_path.display()))?;
        lock.try_lock_exclusive()
            .context("another wat2do process is driving Lightpanda")?;
        Ok(Self {
            binary,
            jars,
            _lock: lock,
        })
    }

    pub fn jar(&self, account: &str) -> anyhow::Result<CookieJar> {
        CookieJar::for_account(&self.jars, account)
    }

    /// Start Lightpanda with `account`'s jar and open Instagram.
    pub async fn open(&self, account: &str) -> anyhow::Result<Browser> {
        let mut browser = Browser::launch(&self.binary, self.jar(account)?).await?;
        if let Err(error) = browser.navigate(HOME_URL).await {
            let _ = browser.close().await;
            return Err(error);
        }
        Ok(browser)
    }
}
