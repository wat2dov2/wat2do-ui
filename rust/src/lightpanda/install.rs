//! Install the pinned Lightpanda release at a stable path, checked against its
//! SHA-256 before it replaces anything.

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use anyhow::{Context, bail};
use sha2::{Digest, Sha256};
use tokio::process::Command;

use crate::controlbox::INSTAGRAM_LIGHTPANDA as CONTROL;
use crate::instagram_notifications::browser_queue::home_directory;

const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(600);

/// `~/.local/libexec/wat2do/lightpanda`.
pub fn binary_path() -> PathBuf {
    home_directory().join(".local/libexec/wat2do/lightpanda")
}

/// The installed binary, checked against the pinned version before it runs.
pub async fn checked_binary(path: PathBuf) -> anyhow::Result<PathBuf> {
    let output = Command::new(&path)
        .arg("version")
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .await
        .with_context(|| {
            format!(
                "Lightpanda is not installed at {}; run `wat2do-lightpanda install`",
                path.display()
            )
        })?;
    let version = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    if version != CONTROL.version {
        bail!(
            "Lightpanda at {} is {version:?}, not the pinned {}; run `wat2do-lightpanda install`",
            path.display(),
            CONTROL.version
        );
    }
    Ok(path)
}

/// The lowercase hex SHA-256 of `bytes`.
pub fn sha256(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// Download the pinned release and put it at [`binary_path`], unless the installed
/// one already matches the pin. Returns what was done.
pub async fn install() -> anyhow::Result<String> {
    let path = binary_path();
    if fs::read(&path).is_ok_and(|installed| sha256(&installed) == CONTROL.sha256) {
        return Ok(format!(
            "Lightpanda {} is already installed at {}",
            CONTROL.version,
            path.display()
        ));
    }
    // GitHub answers a release download with a redirect to its file host.
    let client = wreq::Client::builder()
        .timeout(DOWNLOAD_TIMEOUT)
        .redirect(wreq::redirect::Policy::limited(10))
        .build()?;
    let download = client
        .get(&CONTROL.download_url)
        .send()
        .await
        .and_then(wreq::Response::error_for_status)
        .context("the Lightpanda release could not be downloaded")?
        .bytes()
        .await
        .context("the Lightpanda release could not be downloaded")?;
    place(&download, &path)?;
    checked_binary(path.clone()).await?;
    Ok(format!(
        "Installed Lightpanda {} at {}",
        CONTROL.version,
        path.display()
    ))
}

/// Put `download` at `path` if it is the pinned build: written beside it, made
/// executable, then renamed over it, so a running copy is never half replaced.
fn place(download: &[u8], path: &Path) -> anyhow::Result<()> {
    let found = sha256(download);
    if found != CONTROL.sha256 {
        bail!(
            "the downloaded Lightpanda has SHA-256 {found}, not the pinned {}; nothing was installed",
            CONTROL.sha256
        );
    }
    let directory = path.parent().expect("the binary lives in a directory");
    fs::create_dir_all(directory)
        .with_context(|| format!("{} could not be created", directory.display()))?;
    let staged = directory.join(".lightpanda.download");
    fs::write(&staged, download)?;
    fs::set_permissions(&staged, fs::Permissions::from_mode(0o755))?;
    fs::rename(&staged, path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checksums_are_lowercase_hex() {
        assert_eq!(
            sha256(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn a_download_that_is_not_the_pinned_build_is_never_installed() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("libexec/lightpanda");
        let error = place(b"not lightpanda", &path).unwrap_err();
        assert!(error.to_string().contains("nothing was installed"));
        assert!(!path.exists());
    }
}
