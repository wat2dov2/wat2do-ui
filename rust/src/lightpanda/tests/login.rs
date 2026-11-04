//! Login outcome detection from recorded page snapshots, and the daily budget, ramp
//! and pause bookkeeping a login goes through.

use std::sync::Arc;

use serde_json::{Value, json};

use super::*;
use crate::instagram_notifications::test_support::{FakeHost, queue};

/// The worker's queue, in a temporary state directory.
fn worker() -> (tempfile::TempDir, Arc<BrowserJobQueue>) {
    let directory = tempfile::tempdir().unwrap();
    let queue = queue(directory.path(), &FakeHost::idle());
    (directory, queue)
}

#[test]
fn recorded_login_pages_are_read_correctly() {
    let fixture: Value =
        serde_json::from_str(include_str!("fixtures/login_pages.json")).expect("fixture");
    for case in fixture["pages"].as_array().unwrap() {
        let state: PageState = serde_json::from_value(case["state"].clone()).unwrap();
        let expected = match case["expect"].as_str().unwrap() {
            "pending" => PageOutcome::Pending,
            "code" => PageOutcome::Code,
            "wrong_password" => PageOutcome::WrongPassword,
            "challenge" => PageOutcome::Challenge,
            other => panic!("unknown expectation {other}"),
        };
        assert_eq!(classify(&state), expected, "{}", case["name"]);
    }
}

#[test]
fn a_refusal_names_the_page_but_never_its_text() {
    assert_eq!(
        refusal(PageOutcome::Challenge, "/challenge/action/"),
        "Instagram asked for a security check (/challenge/action/)"
    );
    assert_eq!(
        refusal(PageOutcome::WrongPassword, "/accounts/login/"),
        "Instagram said the password is wrong"
    );
    assert!(refusal(PageOutcome::Pending, "/accounts/login/").contains("did not answer"));
}

#[test]
fn first_logins_are_ramped_and_every_login_shares_brave_budget() {
    let (_directory, worker) = worker();
    let now = 1_793_700_000.0;
    let limit = CONTROL.new_login_daily_limit;
    assert!(limit < instagram_browser().account_login_daily_limit);
    for index in 0..limit {
        assert!(reserve(&worker, &format!("wat2do.n{index}"), true, now).unwrap());
    }
    assert!(ramp_full(&worker, now).unwrap());
    // The ramp holds a new device back and spends nothing of the account's day.
    assert!(!reserve(&worker, "wat2do.held", true, now).unwrap());
    assert_eq!(
        worker.get_setting("account_login_at:wat2do.held").unwrap(),
        None
    );
    // An account Lightpanda already knows is not a new device, only budgeted.
    assert!(reserve(&worker, "wat2do.known", false, now).unwrap());
    assert!(!reserve(&worker, "wat2do.known", false, now + 60.0).unwrap());
    // A day later the ramp has room again.
    assert!(!ramp_full(&worker, now + 86_400.0).unwrap());
    assert!(reserve(&worker, "wat2do.held", true, now + 86_400.0).unwrap());
}

#[test]
fn an_account_brave_logged_in_today_is_not_logged_in_again() {
    let (_directory, worker) = worker();
    let now = 1_793_700_000.0;
    worker
        .set_setting("account_login_attempts", json!([now - 600.0]))
        .unwrap();
    worker
        .set_setting("account_login_at:wat2do.mun", json!(now - 600.0))
        .unwrap();
    assert!(!reserve(&worker, "wat2do.mun", true, now).unwrap());
    // Nothing of the ramp was spent on it.
    assert_eq!(worker.get_setting(NEW_LOGINS).unwrap(), None);
}

#[test]
fn a_pause_holds_until_a_person_resumes_the_account() {
    let (_directory, worker) = worker();
    assert_eq!(paused(&worker, "wat2do.mun").unwrap(), None);
    let result = pause(
        &worker,
        "wat2do.mun",
        "Instagram said the password is wrong",
    )
    .unwrap();
    assert_eq!(
        result,
        LoginResult::Paused("Instagram said the password is wrong".into())
    );
    assert_eq!(
        paused(&worker, "wat2do.mun").unwrap().as_deref(),
        Some("Instagram said the password is wrong")
    );
    assert_eq!(paused(&worker, "wat2do.ubc").unwrap(), None);
    resume(&worker, "wat2do.mun").unwrap();
    assert_eq!(paused(&worker, "wat2do.mun").unwrap(), None);
}
