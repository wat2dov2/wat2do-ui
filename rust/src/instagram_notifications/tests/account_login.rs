//! Ported from the Python test suite.

use chrono::{DateTime, Utc};

use super::*;
use crate::host::CommandOutput;
use crate::instagram_notifications::test_support::{FakeHost, bridge};

#[test]
fn test_canonical_account_maps_switcher_names_to_school_accounts() {
    assert_eq!(canonical_account("tmu.wat2do.io"), "wat2do.tmu");
    assert_eq!(canonical_account("wat2do.ca"), "wat2do.uwaterloo");
    assert_eq!(canonical_account("wat2do.guelph"), "wat2do.guelph");
}

#[test]
fn test_account_password_reads_the_keychain_and_is_none_when_missing() {
    let host = FakeHost::new(|call| {
        let account = call
            .args
            .iter()
            .position(|argument| argument == "-a")
            .map(|index| call.args[index + 1].clone());
        let found = account.as_deref() == Some("wat2do.guelph");
        Ok(CommandOutput {
            code: if found { 0 } else { 44 },
            stdout: if found { "pw\n" } else { "" }.to_owned(),
            stderr: String::new(),
        })
    });
    let bridge = bridge(&host);

    assert_eq!(
        account_password(&bridge, "wat2do.guelph").as_deref(),
        Some("pw")
    );
    assert_eq!(account_password(&bridge, "wat2do.brocku"), None);
    let calls = host.calls();
    assert_eq!(calls[0].program, "/usr/bin/security");
    assert_eq!(calls[0].args[..2], ["find-generic-password", "-s"]);
}

/// Python's `EmailMessage` with a `Date` header and `set_content(body)`, as raw bytes.
fn email(body: &str, sent: i64) -> Vec<u8> {
    let date = DateTime::<Utc>::from_timestamp(sent, 0)
        .expect("valid timestamp")
        .format("%a, %d %b %Y %H:%M:%S +0000");
    format!(
        "Date: {date}\r\nContent-Type: text/plain; charset=\"utf-8\"\r\n\
         Content-Transfer-Encoding: 7bit\r\nMIME-Version: 1.0\r\n\r\n{body}\r\n"
    )
    .into_bytes()
}

#[test]
fn test_code_in_message_takes_only_a_new_code_for_the_account() {
    let body = "Hi wat2do.ucalgary, 482913 is your Instagram security code.";

    assert_eq!(
        code_in_message(&email(body, 1000), "wat2do.ucalgary", 1000.0).as_deref(),
        Some("482913")
    );
    assert_eq!(
        code_in_message(&email(body, 500), "wat2do.ucalgary", 1000.0),
        None
    );
    assert_eq!(
        code_in_message(&email(body, 1000), "wat2do.guelph", 1000.0),
        None
    );
}

/// A realistic (invented) multipart security-code email: quoted-printable text and
/// HTML parts, with the code split across a soft line break in the text part.
#[test]
fn security_code_is_read_from_a_multipart_quoted_printable_email() {
    let raw = include_bytes!("fixtures/instagram_security_code.eml");
    let sent = DateTime::parse_from_rfc2822("Mon, 02 Nov 2026 14:05:09 +0000")
        .expect("valid date")
        .timestamp() as f64;

    assert_eq!(
        code_in_message(raw, "wat2do.ubc", sent - 5.0).as_deref(),
        Some("482913")
    );
    assert_eq!(
        code_in_message(raw, "WAT2DO.UBC", sent + 30.0).as_deref(),
        Some("482913")
    );
    // Another account's email, and one sent over a minute before the login, are ignored.
    assert_eq!(code_in_message(raw, "wat2do.guelph", sent), None);
    assert_eq!(code_in_message(raw, "wat2do.ubc", sent + 61.0), None);
}

/// An HTML-only email from Instagram with `subject`, sent at the fixture time.
fn html_email(subject: &str, html: &str) -> Vec<u8> {
    format!(
        "From: Instagram <security@mail.instagram.com>\r\nTo: codes@example.com\r\n\
         Subject: {subject}\r\nDate: Mon, 02 Nov 2026 14:05:09 +0000\r\nMIME-Version: 1.0\r\n\
         Content-Type: text/html; charset=\"utf-8\"\r\n\r\n{html}\r\n"
    )
    .into_bytes()
}

fn fixture_sent() -> f64 {
    DateTime::parse_from_rfc2822("Mon, 02 Nov 2026 14:05:09 +0000")
        .expect("valid date")
        .timestamp() as f64
}

#[test]
fn subject_code_is_read_first_in_each_of_instagrams_subject_forms() {
    let html = "<html><body><p>Hi wat2do.ubc,</p><p>Request reference 204811.</p>\
                <p>Use this code: <b>482913</b></p></body></html>";
    for (subject, code) in [
        ("123456 is your Instagram code", "123456"),
        ("Your Instagram code is 123456", "123456"),
        ("123456 is your Instagram security code", "123456"),
        // A subject without a code (or without the word) leaves the body's first code.
        ("Your Instagram code", "204811"),
        ("Verify your Instagram account 123456", "204811"),
    ] {
        assert_eq!(
            code_in_message(&html_email(subject, html), "wat2do.ubc", fixture_sent()).as_deref(),
            Some(code),
            "{subject}"
        );
    }
}

/// A realistic (invented) HTML-only email whose subject has no code: numbers in the
/// stylesheet, head script, comment, tag attributes, colours and a numeric entity all
/// come before the real code.
#[test]
fn body_code_skips_styles_scripts_attributes_colours_and_entities() {
    let raw = include_bytes!("fixtures/instagram_security_code_html.eml");
    assert_eq!(
        code_in_message(raw, "wat2do.ubc", fixture_sent()).as_deref(),
        Some("482913")
    );
    assert_eq!(code_in_message(raw, "wat2do.guelph", fixture_sent()), None);
}

/// The account is named only in the subject, which also carries the code; the body's
/// earlier six-digit reference is not taken.
#[test]
fn account_named_only_in_the_subject_matches_and_its_code_wins() {
    let raw = include_bytes!("fixtures/instagram_security_code_subject.eml");
    assert_eq!(
        code_in_message(raw, "wat2do.ubc", fixture_sent()).as_deref(),
        Some("731406")
    );
    assert_eq!(code_in_message(raw, "wat2do.guelph", fixture_sent()), None);
}

/// An inbox that never has a code and records each read's budget.
#[derive(Default)]
struct EmptyInbox {
    budgets: std::sync::Mutex<Vec<f64>>,
}

impl Mailbox for EmptyInbox {
    fn newest_code(
        &self,
        _password: &str,
        _username: &str,
        _after: f64,
        budget: f64,
    ) -> Option<String> {
        self.budgets.lock().unwrap().push(budget);
        None
    }
}

#[test]
fn emailed_code_stops_at_its_deadline_with_shrinking_budgets() {
    let wait = control().login_code_wait_seconds;
    for (allowed, limit) in [(12.0, 12.0), (wait + 100.0, wait)] {
        let host = FakeHost::new(|call| {
            assert_eq!(call.program, "/usr/bin/security");
            Ok(CommandOutput {
                code: 0,
                stdout: "fixture-password\n".to_owned(),
                stderr: String::new(),
            })
        });
        let inbox = Arc::new(EmptyInbox::default());
        let bridge = Bridge::new(host.clone(), inbox.clone());
        let start = bridge.monotonic();

        let code = emailed_code(&bridge, "wat2do.ubc", 1_800_000_000.0, start + allowed).unwrap();

        assert_eq!(code, None);
        let elapsed = bridge.monotonic() - start;
        assert!(elapsed <= limit, "{elapsed} > {limit}");
        let budgets = inbox.budgets.lock().unwrap().clone();
        assert!(budgets.len() > 1, "{budgets:?}");
        assert_eq!(budgets[0], limit);
        assert!(
            budgets.windows(2).all(|pair| pair[1] < pair[0]),
            "{budgets:?}"
        );
        assert!(budgets.iter().all(|budget| *budget > 0.0), "{budgets:?}");
    }
}
