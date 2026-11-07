//! The request bodies, checked as pydantic checks them
//! (`schemas/instagram_publishing.py`).

use serde_json::{Value, json};

use super::*;

fn issues<T: std::fmt::Debug>(result: Result<T, ApiError>) -> Value {
    match result {
        Err(ApiError::RequestValidation(issues)) => json!(issues),
        other => panic!("expected a 422, got {other:?}"),
    }
}

fn body(value: Value) -> Body {
    Body::from_value(value, Extra::Forbid)
}

#[test]
fn a_draft_save_holds_the_version_copy_and_event_order() {
    let update = parse_draft_update(body(json!({
        "version": 3, "cover_body": "Body", "caption_intro": "Our picks", "event_ids": [2, "1"]
    })))
    .unwrap();
    assert_eq!(
        update,
        batches::DraftUpdate {
            version: 3,
            caption_intro: "Our picks".into(),
            cover_body: "Body".into(),
            event_ids: vec![2, 1],
        }
    );
    let defaults = parse_draft_update(body(json!({"version": 1, "event_ids": [5]}))).unwrap();
    assert_eq!(
        (defaults.caption_intro, defaults.cover_body),
        (String::new(), String::new())
    );
    // test_draft_allows_more_than_nine_events: the slide limit applies when publishing.
    let long = parse_draft_update(body(
        json!({"version": 3, "event_ids": (1..15).collect::<Vec<i64>>()}),
    ))
    .unwrap();
    assert_eq!(long.event_ids.len(), 14);
}

#[test]
fn draft_saves_are_refused_as_pydantic_refuses_them() {
    let problems = issues(parse_draft_update(body(json!({
        "version": 0,
        "caption_intro": null,
        "cover_body": "x".repeat(121),
        "event_ids": [],
        "status": "published",
    }))));
    let kinds: Vec<(&str, &Value)> = problems
        .as_array()
        .unwrap()
        .iter()
        .map(|issue| (issue["type"].as_str().unwrap(), &issue["loc"]))
        .collect();
    assert_eq!(
        kinds,
        [
            ("greater_than", &json!(["body", "version"])),
            ("string_type", &json!(["body", "caption_intro"])),
            ("string_too_long", &json!(["body", "cover_body"])),
            ("too_short", &json!(["body", "event_ids"])),
            ("extra_forbidden", &json!(["body", "status"])),
        ]
    );
    let missing = issues(parse_draft_update(body(json!({}))));
    assert_eq!(missing[0]["loc"], json!(["body", "version"]));
    assert_eq!(missing[1]["loc"], json!(["body", "event_ids"]));
    let item = issues(parse_draft_update(body(
        json!({"version": 1, "event_ids": [1, 1.5, "x"]}),
    )));
    assert_eq!(item[0]["type"], "int_from_float");
    assert_eq!(item[0]["loc"], json!(["body", "event_ids", 1]));
    assert_eq!(item[1]["type"], "int_parsing");
}

#[test]
fn publishing_names_the_version_the_admin_saw() {
    assert_eq!(parse_publish(body(json!({"version": 4}))).unwrap(), 4);
    let refused = issues(parse_publish(body(json!({"version": -1, "force": true}))));
    assert_eq!(refused[0]["type"], "greater_than");
    assert_eq!(refused[1]["type"], "extra_forbidden");
    assert_eq!(issues(parse_publish(body(json!({}))))[0]["type"], "missing");
}

#[test]
fn songs_are_typed_loosely_but_never_blank_or_long() {
    // test_blank_or_long_songs_are_rejected
    assert_eq!(
        parse_song(body(json!({"query": " the weeknd after hours "}))).unwrap(),
        (" the weeknd after hours ".into(), false)
    );
    assert_eq!(
        parse_song(body(
            json!({"query": "twice doughnut", "asian_campuses_only": true})
        ))
        .unwrap(),
        ("twice doughnut".into(), true)
    );
    for (query, kind) in [
        ("", "string_too_short"),
        ("   ", "string_pattern_mismatch"),
        (&*"x".repeat(201), "string_too_long"),
    ] {
        assert_eq!(
            issues(parse_song(body(json!({"query": query}))))[0]["type"],
            kind
        );
    }
    let null_flag = issues(parse_song(body(
        json!({"query": "a", "asian_campuses_only": null}),
    )));
    assert_eq!(null_flag[0]["type"], "bool_type");
}

#[test]
fn only_approvals_and_rejections_are_accepted() {
    // test_admin_submits_every_staged_decision_at_once, test_only_approvals_and_rejections_are_accepted
    let approved = uuid::Uuid::from_u128(1);
    let rejected = uuid::Uuid::from_u128(2);
    assert_eq!(
        parse_decisions(body(json!({"decisions": [
            {"id": approved, "status": "approved", "note": "ignored"},
            {"id": rejected, "status": "rejected"},
        ]})))
        .unwrap(),
        [(approved, "approved".into()), (rejected, "rejected".into())]
    );
    assert_eq!(
        issues(parse_decisions(body(json!({"decisions": []}))))[0]["type"],
        "too_short"
    );
    let followed = issues(parse_decisions(body(
        json!({"decisions": [{"id": approved, "status": "followed"}]}),
    )));
    assert_eq!(followed[0]["type"], "literal_error");
    assert_eq!(
        followed[0]["loc"],
        json!(["body", "decisions", 0, "status"])
    );
    let many: Vec<Value> = (0..501)
        .map(|_| json!({"id": approved, "status": "approved"}))
        .collect();
    assert_eq!(
        issues(parse_decisions(body(json!({"decisions": many}))))[0]["type"],
        "too_long"
    );
}
