//! The account guard: refusal holds, shares, the breaker, and what it stops.

use std::sync::Arc;

use super::*;
use crate::controlbox::INSTAGRAM_ACCOUNT_GUARD as CONTROL;
use crate::host::Host;
use crate::instagram_notifications::browser_queue::{Finish, LaneRead};
use crate::instagram_notifications::test_support::{FakeHost, queue};

// An account no `account_daily_following_reads` override names (real ones come and
// go as accounts cool down), so its share follows the defaults.
const ACCOUNT: &str = "wat2do.guardtest";
const UDEM: &str = "wat2do.udem";
const HOURS: f64 = 3_600.0;

fn setup() -> (tempfile::TempDir, Arc<FakeHost>, Arc<BrowserJobQueue>) {
    let directory = tempfile::tempdir().unwrap();
    let host = FakeHost::idle();
    let queue = queue(directory.path(), &host);
    (directory, host, queue)
}

fn refused() -> Outcome {
    Outcome::Refused(FOLLOWING_INVALID_JSON.to_owned())
}

fn following(queue: &BrowserJobQueue, username: &str) {
    queue
        .enqueue_following("ubc", "wat2do.ubc", "crawl-1", username, Some("101"), None)
        .unwrap();
}

fn lane_read(queue: &BrowserJobQueue, account: &str, guard: Option<Outcome>) {
    let claimed = queue
        .claim_lightpanda(account, false, true)
        .unwrap()
        .unwrap();
    let failed = guard
        .as_ref()
        .is_some_and(|outcome| *outcome != Outcome::Read);
    let finish = if failed {
        Finish {
            result: None,
            error: Some(FOLLOWING_INVALID_JSON.to_owned()),
            requeue: false,
            refund_rate_limit: false,
        }
    } else {
        Finish::result(json!({"users": []}))
    };
    let read = LaneRead {
        account: account.to_owned(),
        held: false,
        guard,
    };
    queue.finish_lightpanda(&claimed, finish, &read).unwrap();
}

#[test]
fn only_instagrams_own_refusals_count() {
    assert_eq!(
        Outcome::of_failure(FOLLOWING_HTTP_429, false),
        Some(Outcome::Refused(FOLLOWING_HTTP_429.to_owned()))
    );
    assert_eq!(
        Outcome::of_failure(FOLLOWING_INVALID_JSON, false),
        Some(refused())
    );
    assert_eq!(
        Outcome::of_failure(FOLLOWING_LOGIN_WALL, false),
        Some(Outcome::Checkpoint(FOLLOWING_LOGIN_WALL.to_owned()))
    );
    assert!(matches!(
        Outcome::of_failure("Lightpanda did not start in time", true),
        Some(Outcome::Checkpoint(_))
    ));
    assert_eq!(
        Outcome::of_failure("Lightpanda did not start in time", false),
        None
    );
    assert_eq!(
        Outcome::of_failure("Instagram Following read failed", false),
        None
    );
}

#[test]
fn each_refusal_in_a_row_holds_longer_and_a_streak_opens_the_breaker() {
    let mut guard = Guard::default();
    let mut now = 1_000.0;
    let mut holds = Vec::new();
    for _ in 1..CONTROL.breaker_refusal_streak {
        assert!(!guard.record(&CONTROL, &refused(), now));
        holds.push((guard.held_until - now) / HOURS);
        now = guard.held_until;
    }
    assert_eq!(holds[0], CONTROL.refusal_hold_hours);
    assert_eq!(
        holds[1],
        CONTROL.refusal_hold_hours * CONTROL.refusal_backoff_factor
    );
    assert!(
        holds
            .iter()
            .all(|hours| *hours <= CONTROL.refusal_max_hold_hours)
    );
    assert!(guard.tripped().is_none());

    assert!(guard.record(&CONTROL, &refused(), now));
    assert!(guard.tripped().unwrap().contains("refusals in a row"));
    assert!(matches!(
        guard.gate((1e9, 1e9), now + 1e7),
        Gate::Tripped(_)
    ));
}

#[test]
fn a_read_ends_the_streak_only_after_a_quiet_day() {
    let mut guard = Guard::default();
    guard.record(&CONTROL, &refused(), 0.0);
    guard.record(&CONTROL, &Outcome::Read, 3.0 * HOURS);
    assert_eq!(guard.refusals, 1);
    guard.record(
        &CONTROL,
        &Outcome::Read,
        CONTROL.refusal_streak_reset_hours * HOURS,
    );
    assert_eq!(guard.refusals, 0);
}

#[test]
fn small_and_new_accounts_get_a_smaller_share() {
    let now = 400.0 * 86_400.0;
    let old = now - 365.0 * 86_400.0;
    let large = allowance(
        &CONTROL,
        ACCOUNT,
        Some(Size {
            followers: 5_000,
            first_seen: old,
        }),
        now,
    );
    assert_eq!(
        large,
        (
            CONTROL.daily_following_reads,
            CONTROL.hourly_following_reads
        )
    );
    let small = allowance(
        &CONTROL,
        ACCOUNT,
        Some(Size {
            followers: 21,
            first_seen: old,
        }),
        now,
    );
    let small_new = allowance(
        &CONTROL,
        ACCOUNT,
        Some(Size {
            followers: 21,
            first_seen: now,
        }),
        now,
    );
    let unknown = allowance(&CONTROL, ACCOUNT, None, now);
    assert!(small.0 < large.0 && small.1 < large.1);
    assert!(small_new.0 <= small.0);
    assert_eq!(unknown, small_new);
    assert!(small_new.0 >= CONTROL.minimum_daily_following_reads);
}

#[test]
fn a_refusal_holds_the_account_for_hours_across_restarts() {
    let directory = tempfile::tempdir().unwrap();
    let host = FakeHost::idle();
    let first = queue(directory.path(), &host);
    first
        .set_lightpanda_lane(&[], &[ACCOUNT.to_owned()], 1)
        .unwrap();
    following(&first, "club.one");
    lane_read(&first, ACCOUNT, Some(refused()));
    following(&first, "club.two");
    host.advance(1_900.0);

    // A worker started afresh reads the same hold.
    let restarted = queue(directory.path(), &host);
    restarted
        .set_lightpanda_lane(&[], &[ACCOUNT.to_owned()], 1)
        .unwrap();
    assert!(matches!(
        restarted.following_gate(ACCOUNT).unwrap(),
        Gate::Held(_)
    ));
    assert!(
        restarted
            .claim_lightpanda(ACCOUNT, false, true)
            .unwrap()
            .is_none()
    );
    host.advance(CONTROL.refusal_hold_hours * HOURS);
    assert!(
        restarted
            .claim_lightpanda(ACCOUNT, false, true)
            .unwrap()
            .is_some()
    );
}

#[test]
fn an_account_stops_reading_once_its_days_share_is_spent() {
    let (_directory, host, queue) = setup();
    queue
        .set_lightpanda_lane(&[], &[ACCOUNT.to_owned()], 1)
        .unwrap();
    queue
        .set_account_sizes(&[(ACCOUNT.to_owned(), 21, host.time())])
        .unwrap();
    let (daily, hourly) = allowance(
        &CONTROL,
        ACCOUNT,
        Some(Size {
            followers: 21,
            first_seen: host.time(),
        }),
        host.time(),
    );
    for read in 0..daily as usize {
        following(&queue, &format!("club.{read}"));
        lane_read(&queue, ACCOUNT, Some(Outcome::Read));
        host.advance(HOURS / hourly + 10.0);
    }
    following(&queue, "club.last");
    assert!(matches!(
        queue.following_gate(ACCOUNT).unwrap(),
        Gate::Capped(_)
    ));
    assert!(
        queue
            .claim_lightpanda(ACCOUNT, false, true)
            .unwrap()
            .is_none()
    );
    host.advance(86_400.0);
    assert!(
        queue
            .claim_lightpanda(ACCOUNT, false, true)
            .unwrap()
            .is_some()
    );
}

#[test]
fn an_open_breaker_stops_every_automated_request_until_a_person_resets_it() {
    let (_directory, host, queue) = setup();
    queue
        .set_lightpanda_lane(&[ACCOUNT.to_owned()], &[ACCOUNT.to_owned()], 1)
        .unwrap();
    following(&queue, "club.one");
    let claimed = queue
        .claim_lightpanda(ACCOUNT, false, true)
        .unwrap()
        .unwrap();
    let read = LaneRead {
        account: ACCOUNT.to_owned(),
        held: false,
        guard: Some(Outcome::Checkpoint(FOLLOWING_LOGIN_WALL.to_owned())),
    };
    let finish = Finish {
        result: None,
        error: Some(FOLLOWING_LOGIN_WALL.to_owned()),
        requeue: false,
        refund_rate_limit: false,
    };
    queue.finish_lightpanda(&claimed, finish, &read).unwrap();
    assert!(queue.guard_tripped(ACCOUNT).unwrap().is_some());

    host.advance(30.0 * 86_400.0);
    queue
        .set_lightpanda_lane(&[ACCOUNT.to_owned()], &[ACCOUNT.to_owned()], 1)
        .unwrap();
    following(&queue, "club.two");
    queue.enqueue_digest("101", ACCOUNT, "cache-sfu").unwrap();
    // No Following read, no digest in Lightpanda or Brave, no login.
    assert!(
        queue
            .claim_lightpanda(ACCOUNT, true, true)
            .unwrap()
            .is_none()
    );
    queue.set_lightpanda_lane(&[], &[], 0).unwrap();
    assert!(
        queue
            .claim_next(None, false)
            .unwrap()
            .is_none_or(|job| job.kind != "digest")
    );
    assert!(!queue.reserve_account_login(ACCOUNT, host.time()).unwrap());
    assert!(queue.unavailable_accounts(host.time()).unwrap()[ACCOUNT].contains("breaker open"));
    assert!(queue.status().unwrap()["account_guard"][ACCOUNT]["tripped"].is_string());

    queue.resume_account_login(ACCOUNT).unwrap();
    assert!(queue.guard_tripped(ACCOUNT).unwrap().is_none());
    assert!(queue.reserve_account_login(ACCOUNT, host.time()).unwrap());
}

#[test]
fn brave_guards_the_account_it_reads_as() {
    let (_directory, host, queue) = setup();
    following(&queue, "club.one");
    let claimed = queue.claim_next(None, false).unwrap().unwrap();
    queue
        .finish(
            &claimed,
            Finish::result(
                json!({"account_username": UDEM, "username": "club.one", "hidden": true}),
            ),
        )
        .unwrap();
    assert_eq!(
        queue.guard_status(Some(UDEM)).unwrap()[UDEM]["reads_today"],
        0
    );

    following(&queue, "club.two");
    host.advance(HOURS);
    let claimed = queue.claim_next(None, false).unwrap().unwrap();
    assert_eq!(
        queue.guard_status(Some(UDEM)).unwrap()[UDEM]["reads_today"],
        1
    );
    queue
        .finish(
            &claimed,
            Finish {
                result: None,
                error: Some(FOLLOWING_HTTP_429.to_owned()),
                requeue: false,
                refund_rate_limit: false,
            },
        )
        .unwrap();
    following(&queue, "club.three");
    host.advance(HOURS);
    assert!(matches!(queue.following_gate(UDEM).unwrap(), Gate::Held(_)));
    assert!(queue.claim_next(None, false).unwrap().is_none());
}
