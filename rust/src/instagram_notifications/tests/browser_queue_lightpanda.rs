//! Which jobs the Lightpanda lane and Brave each take, and each account's pace and hold.

use std::sync::Arc;

use super::*;
use crate::controlbox::instagram_browser as control;
use crate::instagram_notifications::browser_queue::Finish;
use crate::instagram_notifications::test_support::{FakeHost, queue};

const MUN: &str = "wat2do.mun";
const SFU: &str = "wat2do.sfu";
const UBC: &str = "wat2do.ubc";

fn setup() -> (tempfile::TempDir, Arc<FakeHost>, Arc<BrowserJobQueue>) {
    let directory = tempfile::tempdir().unwrap();
    let host = FakeHost::idle();
    let queue = queue(directory.path(), &host);
    (directory, host, queue)
}

fn accounts(names: &[&str]) -> Vec<String> {
    names.iter().map(|name| (*name).to_owned()).collect()
}

fn following(queue: &BrowserJobQueue, username: &str, max_id: Option<&str>) -> BrowserJob {
    queue
        .enqueue_following("ubc", UBC, "crawl-1", username, Some("101"), max_id)
        .unwrap()
}

#[test]
fn digests_of_the_lanes_accounts_are_read_in_lightpanda_and_the_rest_in_brave() {
    let (_directory, host, queue) = setup();
    let mun = queue.enqueue_digest("101", MUN, "cache-mun").unwrap();
    let ubc = queue.enqueue_digest("102", UBC, "cache-ubc").unwrap();
    queue
        .set_lightpanda_lane(&accounts(&[MUN]), &accounts(&[MUN]), 1)
        .unwrap();

    assert_eq!(queue.peek_account_username().unwrap().as_deref(), Some(UBC));
    assert_eq!(queue.claim_next(None, false).unwrap().unwrap().id, ubc.id);
    assert!(queue.claim_next(None, false).unwrap().is_none());
    assert!(queue.claim_lightpanda(SFU, true, false).unwrap().is_none());
    assert_eq!(
        queue
            .claim_lightpanda(MUN, true, false)
            .unwrap()
            .unwrap()
            .id,
        mun.id
    );

    // A lane that stops saying it runs hands its accounts back to Brave.
    let late = queue.enqueue_digest("101", MUN, "cache-late").unwrap();
    host.advance(INSTAGRAM_LIGHTPANDA.lane_stale_seconds + 1.0);
    assert_eq!(queue.claim_next(None, false).unwrap().unwrap().id, late.id);
}

#[test]
fn brave_reads_following_lists_only_while_the_lane_reads_none() {
    let (_directory, host, queue) = setup();
    let read = following(&queue, "club.one", None);
    queue
        .set_lightpanda_lane(&[], &accounts(&[MUN]), 1)
        .unwrap();
    assert!(queue.claim_next(None, false).unwrap().is_none());
    assert_eq!(queue.status().unwrap()["following"]["readers"], 1);

    queue
        .set_lightpanda_lane(&[], &accounts(&[MUN, SFU]), 2)
        .unwrap();
    assert_eq!(queue.status().unwrap()["following"]["readers"], 2);
    // The lane's digests stay Brave's when it reads no digests.
    assert!(queue.claim_lightpanda(MUN, false, false).unwrap().is_none());
    let claimed = queue.claim_lightpanda(MUN, false, true).unwrap().unwrap();
    assert_eq!(claimed.id, read.id);
    assert_eq!(claimed.state, "running");

    queue.set_lightpanda_lane(&[], &[], 0).unwrap();
    let next = following(&queue, "club.two", None);
    host.advance(3_600.0);
    assert_eq!(queue.claim_next(None, false).unwrap().unwrap().id, next.id);
    assert_eq!(queue.status().unwrap()["following"]["readers"], 1);
}

#[test]
fn each_account_reads_at_its_own_pace() {
    let (_directory, host, queue) = setup();
    queue
        .set_lightpanda_lane(&[], &accounts(&[MUN, SFU]), 2)
        .unwrap();
    let first = following(&queue, "club.one", None);
    host.advance(1.0);
    following(&queue, "club.two", None);
    let claimed = queue.claim_lightpanda(MUN, false, true).unwrap().unwrap();
    assert_eq!(claimed.id, first.id);
    queue
        .finish_lightpanda(
            &claimed,
            Finish::result(json!({"users": []})),
            &read(MUN, false),
        )
        .unwrap();

    // MUN waits its spacing; SFU reads at once.
    assert!(queue.claim_lightpanda(MUN, false, true).unwrap().is_none());
    assert!(queue.claim_lightpanda(SFU, false, true).unwrap().is_some());
    let pace = queue.lightpanda_pace(MUN).unwrap();
    assert_eq!(pace.reads.len(), 1);
    assert!(pace.next_list_at > host_time(&host));

    following(&queue, "club.three", None);
    host.advance(3_600.0 / control().following_requests_per_hour as f64);
    host.advance(control().following_list_delay_max_seconds);
    assert!(queue.claim_lightpanda(MUN, false, true).unwrap().is_some());
}

fn read(account: &str, held: bool) -> LaneRead {
    LaneRead {
        account: account.to_owned(),
        held,
    }
}

fn refused() -> Finish {
    Finish {
        result: None,
        error: Some("Instagram Following read failed with HTTP 429".into()),
        requeue: true,
        refund_rate_limit: true,
    }
}

fn host_time(host: &FakeHost) -> f64 {
    crate::host::Host::time(host)
}

#[test]
fn a_hold_stops_only_that_account_and_backs_off() {
    let (_directory, host, queue) = setup();
    queue
        .set_lightpanda_lane(&[], &accounts(&[MUN, SFU]), 2)
        .unwrap();
    following(&queue, "club.one", None);
    let claimed = queue.claim_lightpanda(MUN, false, true).unwrap().unwrap();
    queue
        .finish_lightpanda(&claimed, refused(), &read(MUN, true))
        .unwrap();
    let first = queue.lightpanda_pace(MUN).unwrap();
    assert_eq!(first.backoff, control().rate_limit_backoff_seconds);
    assert!(queue.status().unwrap()["lightpanda"]["held_until"][MUN].is_number());

    host.advance(control().following_list_delay_max_seconds);
    assert!(queue.claim_lightpanda(MUN, false, true).unwrap().is_none());
    let retried = queue.claim_lightpanda(SFU, false, true).unwrap().unwrap();
    assert_eq!(retried.attempts, 1);

    // Held again soon after: twice as long.
    host.advance(control().rate_limit_backoff_seconds);
    queue
        .finish_lightpanda(&retried, refused(), &read(MUN, true))
        .unwrap();
    assert_eq!(
        queue.lightpanda_pace(MUN).unwrap().backoff,
        control().rate_limit_backoff_seconds * 2.0
    );
}

#[test]
fn following_pause_stops_the_lanes_reads_too() {
    let (_directory, _host, queue) = setup();
    queue
        .set_lightpanda_lane(&[], &accounts(&[MUN]), 1)
        .unwrap();
    following(&queue, "club.one", Some("50"));
    queue
        .set_setting(FOLLOWING_PAUSED, json!("stopped by an operator"))
        .unwrap();
    assert!(queue.claim_lightpanda(MUN, false, true).unwrap().is_none());
    queue.set_setting(FOLLOWING_PAUSED, Value::Null).unwrap();
    assert!(queue.claim_lightpanda(MUN, false, true).unwrap().is_some());
}

#[test]
fn digest_counts_and_waiting_digests_name_the_accounts() {
    let (_directory, _host, queue) = setup();
    queue.enqueue_digest("101", MUN, "cache-1").unwrap();
    queue.enqueue_digest("101", MUN, "cache-2").unwrap();
    queue.enqueue_digest("102", SFU, "cache-3").unwrap();
    assert_eq!(
        queue.digest_counts(0.0).unwrap(),
        [(MUN.to_owned(), 2), (SFU.to_owned(), 1)]
    );
    assert_eq!(
        queue.lightpanda_pending().unwrap(),
        LanePending {
            digests: [MUN.to_owned(), SFU.to_owned()].into_iter().collect(),
            following: false,
        }
    );
    following(&queue, "club.one", None);
    assert!(queue.lightpanda_pending().unwrap().following);
}

#[test]
fn a_list_whose_owner_id_is_unknown_stays_braves() {
    let (_directory, _host, queue) = setup();
    queue
        .set_lightpanda_lane(&[], &accounts(&[MUN]), 1)
        .unwrap();
    let lookup = queue
        .enqueue_following("ubc", UBC, "crawl-1", "wat2do.ubc", None, None)
        .unwrap();
    assert!(queue.claim_lightpanda(MUN, false, true).unwrap().is_none());
    assert_eq!(
        queue.claim_next(None, false).unwrap().unwrap().id,
        lookup.id
    );
}

#[test]
fn brave_takes_a_lane_digest_left_waiting_too_long() {
    let (_directory, host, queue) = setup();
    let digest = queue.enqueue_digest("101", MUN, "cache-mun").unwrap();
    queue
        .set_lightpanda_lane(&accounts(&[MUN]), &accounts(&[MUN]), 1)
        .unwrap();
    assert!(queue.claim_next(None, false).unwrap().is_none());
    host.advance(INSTAGRAM_LIGHTPANDA.lane_digest_wait_seconds + 1.0);
    queue
        .set_lightpanda_lane(&accounts(&[MUN]), &accounts(&[MUN]), 1)
        .unwrap();
    assert_eq!(
        queue.claim_next(None, false).unwrap().unwrap().id,
        digest.id
    );
}

#[test]
fn brave_recovery_leaves_the_running_lanes_reads_alone() {
    let (_directory, host, queue) = setup();
    queue
        .set_lightpanda_lane(&[], &accounts(&[MUN]), 1)
        .unwrap();
    following(&queue, "club.one", None);
    let claimed = queue.claim_lightpanda(MUN, false, true).unwrap().unwrap();

    // A storage hiccup makes Brave recover the queue while the lane still reads.
    queue.recover_interrupted().unwrap();
    assert_eq!(queue.get(&claimed.id).unwrap().unwrap().state, "running");
    queue
        .finish_lightpanda(
            &claimed,
            Finish::result(json!({"users": []})),
            &read(MUN, false),
        )
        .unwrap();
    let finished = queue.get(&claimed.id).unwrap().unwrap();
    assert_eq!(
        (finished.state.as_str(), finished.attempts),
        ("succeeded", 1)
    );

    // Once the lane stops saying it runs, its reads are recovery's again.
    let wait = 3_600.0 + control().following_list_delay_max_seconds;
    following(&queue, "club.two", None);
    host.advance(wait);
    queue
        .set_lightpanda_lane(&[], &accounts(&[MUN]), 1)
        .unwrap();
    let stranded = queue.claim_lightpanda(MUN, false, true).unwrap().unwrap();
    host.advance(INSTAGRAM_LIGHTPANDA.lane_stale_seconds + 1.0);
    queue.recover_interrupted().unwrap();
    assert_eq!(queue.get(&stranded.id).unwrap().unwrap().state, "pending");

    // And a worker that starts afresh forgets an earlier lane at once.
    host.advance(wait);
    queue
        .set_lightpanda_lane(&[], &accounts(&[MUN]), 1)
        .unwrap();
    let again = queue.claim_lightpanda(MUN, false, true).unwrap().unwrap();
    queue.reset_lightpanda_lane().unwrap();
    queue.recover_interrupted().unwrap();
    assert_eq!(queue.get(&again.id).unwrap().unwrap().state, "pending");
}

#[test]
fn the_lanes_reads_never_pace_or_reset_braves() {
    let (_directory, _host, queue) = setup();
    queue
        .set_setting("following_rate_limit_backoff_seconds", json!(240.0))
        .unwrap();
    queue
        .set_lightpanda_lane(&[], &accounts(&[MUN]), 1)
        .unwrap();
    following(&queue, "club.one", None);
    let claimed = queue.claim_lightpanda(MUN, false, true).unwrap().unwrap();
    queue
        .finish_lightpanda(
            &claimed,
            Finish::result(json!({"users": []})),
            &read(MUN, false),
        )
        .unwrap();
    assert_eq!(queue.get_setting("following_next_list_at").unwrap(), None);
    assert_eq!(queue.get_setting("following_next_page_at").unwrap(), None);
    assert_eq!(
        queue
            .get_setting("following_rate_limit_backoff_seconds")
            .unwrap(),
        Some(json!(240.0))
    );
    assert!(queue.lightpanda_pace(MUN).unwrap().next_list_at > 0.0);
}
