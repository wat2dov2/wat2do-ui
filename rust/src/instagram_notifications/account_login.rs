//! What Brave needs to log a school account back in: its password and any emailed code.
//!
//! Passwords live in the Mac's login Keychain (one generic password per school account
//! under `login_keychain_service`) and are handed straight to the login form; they are
//! never logged, stored elsewhere or put on a command line. Instagram sends security
//! codes to one Gmail inbox, read over IMAP with an app password kept in the Keychain.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::sync::{Arc, LazyLock};
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use regex::Regex;

use super::browser_session::Bridge;
use super::errors::BrowserResult;
use crate::controlbox::instagram_browser as control;

const SECURITY: &str = "/usr/bin/security";
const IMAP_PORT: u16 = 993;
const IMAP_TIMEOUT: Duration = Duration::from_secs(20);

static SWITCHER_DOMAIN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^([a-z0-9_]+)[.]wat2do[.]io$").expect("valid regex"));
static DIGITS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\d+").expect("valid regex"));
static TAG: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"<[^>]+>").expect("valid regex"));

/// `wat2do.<school>` for a name Instagram's saved profiles or switcher show.
pub fn canonical_account(name: &str) -> String {
    let name = name.to_lowercase();
    if let Some(found) = SWITCHER_DOMAIN.captures(&name) {
        return format!("wat2do.{}", &found[1]);
    }
    for (school, shown) in &control().school_switcher_username_overrides {
        if shown.to_lowercase() == name {
            return format!("wat2do.{school}");
        }
    }
    name
}

fn keychain_secret(bridge: &Bridge, service: &str, account: &str) -> Option<String> {
    let arguments =
        ["find-generic-password", "-s", service, "-a", account, "-w"].map(str::to_owned);
    let completed = bridge.host.run(SECURITY, &arguments, None, 10.0).ok()?;
    (completed.code == 0).then_some(completed.stdout)
}

/// The account's password from the Keychain, or None when none is stored.
pub fn account_password(bridge: &Bridge, username: &str) -> Option<String> {
    let password = keychain_secret(bridge, &control().login_keychain_service, username)?;
    let password = password.trim_end_matches('\n');
    (!password.is_empty()).then(|| password.to_owned())
}

fn imap_password(bridge: &Bridge) -> Option<String> {
    let password = keychain_secret(
        bridge,
        &control().login_code_keychain_service,
        &control().login_code_email,
    )?;
    let password = password.trim();
    (!password.is_empty()).then(|| password.to_owned())
}

/// Wait for Instagram's security code for the account, sent after `sent_after`, at
/// most `login_code_wait_seconds` and never past `deadline` (the caller's monotonic
/// deadline); each inbox read is bounded by what is left.
pub fn emailed_code(
    bridge: &Bridge,
    username: &str,
    sent_after: f64,
    deadline: f64,
) -> BrowserResult<Option<String>> {
    let Some(password) = imap_password(bridge) else {
        return Ok(None);
    };
    let deadline = deadline.min(bridge.monotonic() + control().login_code_wait_seconds);
    loop {
        let budget = deadline - bridge.monotonic();
        if budget <= 0.0 {
            return Ok(None);
        }
        let code = bridge
            .mailbox
            .newest_code(&password, username, sent_after, budget);
        if code.is_some() || bridge.monotonic() >= deadline {
            return Ok(code);
        }
        bridge.sleep(5.0_f64.min((deadline - bridge.monotonic()).max(0.0)))?;
    }
}

/// The Gmail inbox Instagram sends security codes to.
pub trait Mailbox: Send + Sync {
    /// The newest code for `username` among Instagram's last ten emails, if any is new,
    /// giving up after `budget` seconds.
    fn newest_code(
        &self,
        imap_password: &str,
        username: &str,
        sent_after: f64,
        budget: f64,
    ) -> Option<String>;
}

/// Gmail over IMAP, read-only.
pub struct ImapMailbox;

impl Mailbox for ImapMailbox {
    fn newest_code(
        &self,
        imap_password: &str,
        username: &str,
        sent_after: f64,
        budget: f64,
    ) -> Option<String> {
        let until = Instant::now() + Duration::from_secs_f64(budget.max(0.0));
        let messages = recent_instagram_messages(imap_password, sent_after, until).ok()?;
        messages
            .iter()
            .find_map(|raw| code_in_message(raw, username, sent_after))
    }
}

/// The security code in one of Instagram's emails to this account, if it is new.
///
/// The subject ("123456 is your Instagram code") is read first. Otherwise the code is
/// the first six-digit number of the visible text, never one inside a stylesheet, a
/// script, a tag's attributes, or a colour like `#123456`.
pub fn code_in_message(raw: &[u8], username: &str, sent_after: f64) -> Option<String> {
    let message = mail_parser::MessageParser::default().parse(raw)?;
    let sent = message.date()?;
    let sent = DateTime::<Utc>::from_timestamp(sent.to_timestamp(), 0)?.timestamp() as f64;
    if sent < sent_after - 60.0 {
        return None;
    }
    let subject = message.subject().unwrap_or_default();
    let text = message_text(&message);
    let username = username.to_lowercase();
    if !text.to_lowercase().contains(&username) && !subject.to_lowercase().contains(&username) {
        return None;
    }
    if subject.to_lowercase().contains("code")
        && let Some(code) = six_digits(subject)
    {
        return Some(code);
    }
    six_digits(&text)
}

/// The first run of exactly six digits that is not a `#` colour or entity.
fn six_digits(text: &str) -> Option<String> {
    DIGITS
        .find_iter(text)
        .find(|run| run.as_str().chars().count() == 6 && !text[..run.start()].ends_with('#'))
        .map(|run| run.as_str().to_owned())
}

/// Every text/plain and text/html part, decoded and joined, without stylesheets,
/// scripts, comments or tags.
fn message_text(message: &mail_parser::Message<'_>) -> String {
    use mail_parser::{MimeHeaders, PartType};
    static HIDDEN: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(?is)<style\b.*?</style\s*>|<script\b.*?</script\s*>|<!--.*?-->")
            .expect("valid regex")
    });
    let chunks: Vec<String> = message
        .parts
        .iter()
        .filter_map(|part| {
            let content_type = part.content_type();
            let (kind, subtype) = content_type.map_or(("text", Some("plain")), |content_type| {
                (content_type.ctype(), content_type.subtype())
            });
            let wanted = kind.eq_ignore_ascii_case("text")
                && subtype.is_some_and(|subtype| {
                    subtype.eq_ignore_ascii_case("plain") || subtype.eq_ignore_ascii_case("html")
                });
            match &part.body {
                PartType::Text(text) | PartType::Html(text) if wanted => Some(text.to_string()),
                _ => None,
            }
        })
        .collect();
    let joined = chunks.join(" ");
    let visible = HIDDEN.replace_all(&joined, " ");
    TAG.replace_all(&visible, " ").into_owned()
}

/// Instagram's last ten emails since a day before `sent_after`, newest first.
fn recent_instagram_messages(
    password: &str,
    sent_after: f64,
    until: Instant,
) -> std::io::Result<Vec<Vec<u8>>> {
    let mut session = ImapSession::connect(&control().login_code_imap_host, until)?;
    let result = (|| {
        session.command(&format!(
            "LOGIN {} {}",
            quote(&control().login_code_email),
            quote(password)
        ))?;
        session.command("EXAMINE INBOX")?;
        let since = DateTime::<Utc>::from_timestamp((sent_after - 86_400.0) as i64, 0)
            .unwrap_or_default()
            .format("%d-%b-%Y");
        let found = session.command(&format!("SEARCH FROM \"instagram\" SINCE {since}"))?;
        let ids: Vec<String> = found
            .lines
            .iter()
            .filter_map(|line| line.strip_prefix("* SEARCH"))
            .flat_map(|ids| {
                ids.split_whitespace()
                    .map(str::to_owned)
                    .collect::<Vec<_>>()
            })
            .collect();
        let mut messages = Vec::new();
        for id in ids.iter().rev().take(10) {
            let fetched = session.command(&format!("FETCH {id} (RFC822)"))?;
            if let Some(raw) = fetched.literals.into_iter().next() {
                messages.push(raw);
            }
        }
        Ok(messages)
    })();
    let _ = session.command("LOGOUT");
    result
}

/// `imaplib`'s quoting of a command argument.
fn quote(argument: &str) -> String {
    format!(
        "\"{}\"",
        argument.replace('\\', "\\\\").replace('"', "\\\"")
    )
}

struct ImapResponse {
    lines: Vec<String>,
    literals: Vec<Vec<u8>>,
}

struct ImapSession {
    stream: BufReader<rustls::StreamOwned<rustls::ClientConnection, TcpStream>>,
    tag: u32,
    /// The whole session ends by this instant, whatever the server does.
    until: Instant,
}

/// What is left until `until`, capped at the per-read timeout; an error once it is spent.
fn time_left(until: Instant) -> std::io::Result<Duration> {
    let left = until.saturating_duration_since(Instant::now());
    if left.is_zero() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::TimedOut,
            "IMAP deadline passed",
        ));
    }
    Ok(left.min(IMAP_TIMEOUT))
}

impl ImapSession {
    fn connect(host: &str, until: Instant) -> std::io::Result<Self> {
        let address = (host, IMAP_PORT)
            .to_socket_addrs()?
            .next()
            .ok_or_else(|| std::io::Error::other("IMAP host has no address"))?;
        let tcp = TcpStream::connect_timeout(&address, time_left(until)?)?;
        tcp.set_read_timeout(Some(time_left(until)?))?;
        tcp.set_write_timeout(Some(time_left(until)?))?;
        let roots =
            rustls::RootCertStore::from_iter(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
        let config = rustls::ClientConfig::builder()
            .with_root_certificates(roots)
            .with_no_client_auth();
        let name = rustls::pki_types::ServerName::try_from(host.to_owned())
            .map_err(|_| std::io::Error::other("IMAP host name is invalid"))?;
        let connection =
            rustls::ClientConnection::new(Arc::new(config), name).map_err(std::io::Error::other)?;
        let mut session = Self {
            stream: BufReader::new(rustls::StreamOwned::new(connection, tcp)),
            tag: 0,
            until,
        };
        let greeting = session.read_line()?;
        if !greeting.starts_with("* OK") {
            return Err(std::io::Error::other("IMAP server refused the connection"));
        }
        Ok(session)
    }

    fn read_line(&mut self) -> std::io::Result<String> {
        let left = time_left(self.until)?;
        self.stream.get_ref().sock.set_read_timeout(Some(left))?;
        let mut line = Vec::new();
        self.stream.read_until(b'\n', &mut line)?;
        if line.is_empty() {
            return Err(std::io::Error::other("IMAP connection closed"));
        }
        Ok(String::from_utf8_lossy(&line)
            .trim_end_matches(['\r', '\n'])
            .to_owned())
    }

    /// Send one tagged command and read its untagged lines and literals until the
    /// tagged status; anything but OK is an error.
    fn command(&mut self, command: &str) -> std::io::Result<ImapResponse> {
        self.tag += 1;
        let tag = format!("W{}", self.tag);
        let left = time_left(self.until)?;
        self.stream.get_ref().sock.set_write_timeout(Some(left))?;
        let stream = self.stream.get_mut();
        stream.write_all(format!("{tag} {command}\r\n").as_bytes())?;
        stream.flush()?;
        let mut response = ImapResponse {
            lines: Vec::new(),
            literals: Vec::new(),
        };
        static LITERAL: LazyLock<Regex> =
            LazyLock::new(|| Regex::new(r"\{(\d+)\}$").expect("valid regex"));
        loop {
            let line = self.read_line()?;
            if let Some(status) = line.strip_prefix(&format!("{tag} ")) {
                return if status.starts_with("OK") {
                    Ok(response)
                } else {
                    Err(std::io::Error::other("IMAP command was refused"))
                };
            }
            if let Some(size) = LITERAL
                .captures(&line)
                .and_then(|found| found[1].parse::<usize>().ok())
            {
                let mut literal = vec![0; size];
                self.stream.read_exact(&mut literal)?;
                response.literals.push(literal);
            }
            response.lines.push(line);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn email(date: &str, body: &str) -> Vec<u8> {
        format!(
            "From: Instagram <security@mail.instagram.com>\r\nTo: inbox@example.com\r\nDate: {date}\r\nSubject: code\r\nContent-Type: text/html; charset=utf-8\r\n\r\n{body}\r\n"
        )
        .into_bytes()
    }

    #[test]
    fn switcher_names_map_to_school_accounts() {
        assert_eq!(canonical_account("UBC.wat2do.io"), "wat2do.ubc");
        assert_eq!(canonical_account("wat2do.ca"), "wat2do.uwaterloo");
        assert_eq!(canonical_account("wat2do.guelph"), "wat2do.guelph");
    }

    #[test]
    fn a_new_code_for_the_account_is_read_from_html() {
        // Fri, 31 Oct 2026 12:00:00 +0000 is 1793448000.
        let sent_after = 1_793_448_000.0;
        let raw = email(
            "Sat, 31 Oct 2026 12:00:30 +0000",
            "<p>Hi wat2do.ubc,</p><p>Your code is <b>123456</b>. Ref 1234567</p>",
        );
        assert_eq!(
            code_in_message(&raw, "WAT2DO.UBC", sent_after).as_deref(),
            Some("123456")
        );
        // Another account's email, an old email and one without a code are ignored.
        assert_eq!(code_in_message(&raw, "wat2do.guelph", sent_after), None);
        let old = email("Sat, 31 Oct 2026 11:58:00 +0000", "wat2do.ubc 123456");
        assert_eq!(code_in_message(&old, "wat2do.ubc", sent_after), None);
        let codeless = email("Sat, 31 Oct 2026 12:00:30 +0000", "wat2do.ubc 1234567");
        assert_eq!(code_in_message(&codeless, "wat2do.ubc", sent_after), None);
        assert_eq!(
            code_in_message(b"not an email", "wat2do.ubc", sent_after),
            None
        );
    }
}

/// The Python suite's cases, ported.
#[cfg(test)]
#[path = "tests/account_login.rs"]
mod python_tests;
