//! Each school account's Lightpanda cookie jar: one owner-only file in the worker's
//! state directory. Lightpanda reads it at start and writes its cookies to a sibling
//! file when the page closes; that file replaces the jar only when it is readable and
//! does not drop a login the old jar still holds.

use std::fs;
use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use anyhow::{Context, bail};
use regex::Regex;
use serde_json::Value;

/// The cookie that holds an Instagram login.
pub const SESSION_COOKIE: &str = "sessionid";

/// Instagram usernames: what may name a jar file.
static ACCOUNT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[a-z0-9_][a-z0-9._]{0,29}$").expect("valid regex"));

#[derive(Debug, Clone)]
pub struct CookieJar {
    path: PathBuf,
}

impl CookieJar {
    /// The jar for `account` under `directory`, which is created owner-only.
    pub fn for_account(directory: &Path, account: &str) -> anyhow::Result<Self> {
        if !ACCOUNT.is_match(account) {
            bail!("{account:?} is not an Instagram username");
        }
        create_directory(directory)?;
        Ok(Self {
            path: directory.join(format!("{account}.json")),
        })
    }

    /// The owner-only directory that holds the jars.
    pub fn directory(&self) -> &Path {
        self.path.parent().expect("a jar lives in a directory")
    }

    /// The saved jar, when there is one.
    pub fn saved(&self) -> Option<&Path> {
        self.path.exists().then_some(self.path.as_path())
    }

    /// Whether the account has never had a Lightpanda jar: its first login is a new
    /// device to Instagram.
    pub fn is_new_device(&self) -> bool {
        !self.path.exists()
    }

    /// Whether the saved jar holds a login.
    pub fn holds_session(&self) -> bool {
        read(&self.path).is_ok_and(|cookies| holds_login(&cookies))
    }

    /// Where Lightpanda writes the cookies it holds when the page closes.
    pub fn next_path(&self) -> PathBuf {
        self.path.with_extension("next.json")
    }

    /// Replace the jar with what Lightpanda saved, unless that is unreadable or
    /// drops the login the jar still holds.
    pub fn keep_next(&self) -> anyhow::Result<()> {
        let next = self.next_path();
        if !next.exists() {
            return Ok(());
        }
        fs::set_permissions(&next, fs::Permissions::from_mode(0o600))?;
        let Ok(cookies) = read(&next) else {
            fs::remove_file(&next)?;
            bail!("Lightpanda saved an unreadable cookie jar; the previous one is kept");
        };
        if holds_login(&cookies) || !self.holds_session() {
            fs::rename(&next, &self.path).context("the cookie jar could not be replaced")?;
        } else {
            fs::remove_file(&next)?;
        }
        Ok(())
    }
}

/// Create the jars' directory, owner-only.
pub fn create_directory(directory: &Path) -> anyhow::Result<()> {
    fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(directory)
        .with_context(|| format!("{} could not be created", directory.display()))?;
    fs::set_permissions(directory, fs::Permissions::from_mode(0o700))?;
    Ok(())
}

/// The cookies in a jar file: a JSON array of named cookies.
fn read(path: &Path) -> anyhow::Result<Vec<Value>> {
    let cookies: Value = serde_json::from_slice(&fs::read(path)?)?;
    match cookies {
        Value::Array(cookies)
            if cookies
                .iter()
                .all(|cookie| cookie.get("name").and_then(Value::as_str).is_some()) =>
        {
            Ok(cookies)
        }
        _ => bail!("not a cookie jar"),
    }
}

/// Whether `cookies` hold a non-empty Instagram session cookie: the account is logged in.
pub fn holds_login(cookies: &[Value]) -> bool {
    cookies.iter().any(|cookie| {
        cookie.get("name").and_then(Value::as_str) == Some(SESSION_COOKIE)
            && cookie
                .get("value")
                .and_then(Value::as_str)
                .is_some_and(|value| !value.is_empty())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn write(path: &Path, cookies: Value) {
        fs::write(path, cookies.to_string()).unwrap();
    }

    fn device() -> Value {
        json!([{"name": "mid", "value": "fixture", "domain": ".instagram.com"}])
    }

    fn logged_in() -> Value {
        json!([
            {"name": "mid", "value": "fixture", "domain": ".instagram.com"},
            {"name": "sessionid", "value": "fixture", "domain": ".instagram.com"}
        ])
    }

    #[test]
    fn only_a_non_empty_session_cookie_is_a_login() {
        assert!(holds_login(logged_in().as_array().unwrap()));
        assert!(!holds_login(device().as_array().unwrap()));
        let empty = json!([{"name": "sessionid", "value": ""}]);
        assert!(!holds_login(empty.as_array().unwrap()));
        let unnamed = json!([{"value": "fixture"}]);
        assert!(!holds_login(unnamed.as_array().unwrap()));
    }

    #[test]
    fn jars_are_owner_only_and_named_after_valid_accounts() {
        let state = tempfile::tempdir().unwrap();
        let directory = state.path().join("lightpanda");
        let jar = CookieJar::for_account(&directory, "wat2do.mun").unwrap();
        let mode = fs::metadata(&directory).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o700);
        assert!(jar.is_new_device());
        assert_eq!(jar.saved(), None);
        for bad in ["../wat2do.mun", "WAT2DO.MUN", ".hidden", "", "a/b"] {
            assert!(CookieJar::for_account(&directory, bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn a_saved_login_replaces_the_jar_owner_only() {
        let state = tempfile::tempdir().unwrap();
        let jar = CookieJar::for_account(state.path(), "wat2do.mun").unwrap();
        write(&jar.next_path(), logged_in());
        jar.keep_next().unwrap();
        assert!(jar.holds_session());
        assert!(!jar.next_path().exists());
        let mode = fs::metadata(jar.saved().unwrap())
            .unwrap()
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o600);
    }

    #[test]
    fn device_cookies_are_kept_after_a_failed_first_login() {
        let state = tempfile::tempdir().unwrap();
        let jar = CookieJar::for_account(state.path(), "wat2do.mun").unwrap();
        write(&jar.next_path(), device());
        jar.keep_next().unwrap();
        assert!(!jar.is_new_device());
        assert!(!jar.holds_session());
    }

    #[test]
    fn a_jar_without_the_login_never_replaces_one_with_it() {
        let state = tempfile::tempdir().unwrap();
        let jar = CookieJar::for_account(state.path(), "wat2do.mun").unwrap();
        write(&jar.path, logged_in());
        write(&jar.next_path(), device());
        jar.keep_next().unwrap();
        assert!(jar.holds_session());
        assert!(!jar.next_path().exists());
    }

    #[test]
    fn an_unreadable_save_is_discarded_and_reported() {
        let state = tempfile::tempdir().unwrap();
        let jar = CookieJar::for_account(state.path(), "wat2do.mun").unwrap();
        write(&jar.path, logged_in());
        fs::write(jar.next_path(), "{\"truncated\": ").unwrap();
        assert!(jar.keep_next().is_err());
        assert!(jar.holds_session());
        assert!(!jar.next_path().exists());
        // Nothing saved at all keeps the jar as it was.
        jar.keep_next().unwrap();
        assert!(jar.holds_session());
    }
}
