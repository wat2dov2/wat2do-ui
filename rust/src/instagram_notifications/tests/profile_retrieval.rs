//! Ported from `tests/services/instagram_notifications/test_profile_retrieval.py`.

use std::cell::RefCell;

use serde_json::json;

use super::*;
use crate::instagram_notifications::browser_queue::Finish;
use crate::instagram_notifications::test_support::{FakeHost, queue};

const RECIPIENT_ID: &str = "12342599092";
const PROFILE: &str = "https://www.instagram.com/ubcclub/";

fn listed(queue: &BrowserJobQueue, posts: serde_json::Value, requested: bool, url: &str) -> String {
    let job_id = queue
        .enqueue_retrieval("ubc", RECIPIENT_ID, "wat2do.ubc", url, 1)
        .unwrap();
    if requested {
        queue
            .set_setting(&format!("profile_request:{job_id}"), Value::Bool(true))
            .unwrap();
    }
    let claim = queue
        .claim_next(None, true)
        .unwrap()
        .expect("a job to claim");
    queue
        .finish(
            &claim,
            Finish::result(json!({"target_url": url, "posts": posts})),
        )
        .unwrap();
    job_id
}

#[test]
fn test_each_listed_post_joins_the_ingestion_queue_once() {
    let directory = tempfile::tempdir().unwrap();
    let host = FakeHost::idle();
    let queue = queue(&directory.path().join("state"), &host);
    let calls: RefCell<Vec<(Vec<String>, String)>> = RefCell::new(Vec::new());
    let queue_posts = |urls: &[String], school: &str| -> Result<usize> {
        calls.borrow_mut().push((urls.to_vec(), school.to_owned()));
        Ok(urls.len())
    };
    listed(
        &queue,
        json!([
            {"url": "https://www.instagram.com/p/One/"},
            {"url": "https://www.instagram.com/reel/Two/"},
        ]),
        true,
        PROFILE,
    );
    // A retrieval nobody requested as a profile listing (an old notification read).
    listed(
        &queue,
        json!([{"url": "https://www.instagram.com/p/Old/"}]),
        false,
        "https://www.instagram.com/otherclub/",
    );

    assert_eq!(
        queue_retrieved_profiles(&queue, &queue_posts).unwrap(),
        json!({"queued": 2, "invalid": 0})
    );
    assert_eq!(
        queue_retrieved_profiles(&queue, &queue_posts).unwrap(),
        json!({"queued": 0, "invalid": 0})
    );
    assert_eq!(
        *calls.borrow(),
        vec![(
            vec![
                "https://www.instagram.com/p/One/".to_owned(),
                "https://www.instagram.com/reel/Two/".to_owned(),
            ],
            "ubc".to_owned(),
        )]
    );
}

#[test]
fn test_a_mismatched_result_is_not_queued() {
    let directory = tempfile::tempdir().unwrap();
    let host = FakeHost::idle();
    let queue = queue(&directory.path().join("state"), &host);
    let queue_posts =
        |_: &[String], _: &str| -> Result<usize> { panic!("a mismatched result must not queue") };
    let job_id = queue
        .enqueue_retrieval("ubc", RECIPIENT_ID, "wat2do.ubc", PROFILE, 1)
        .unwrap();
    queue
        .set_setting(&format!("profile_request:{job_id}"), Value::Bool(true))
        .unwrap();
    let claim = queue
        .claim_next(None, true)
        .unwrap()
        .expect("a job to claim");
    queue
        .finish(
            &claim,
            Finish::result(
                json!({"target_url": "https://www.instagram.com/elsewhere/", "posts": []}),
            ),
        )
        .unwrap();

    assert_eq!(
        queue_retrieved_profiles(&queue, &queue_posts).unwrap(),
        json!({"queued": 0, "invalid": 1})
    );
}
