//! The batch reads' rules, ported from `tests/services/instagram_publishing/test_service.py`.

use chrono::TimeZone;
use serde_json::json;

use super::*;
use crate::api::events::model::{EventRow, Occurrence, hydrate};

fn at(year: i32, month: u32, day: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(year, month, day, 22, 0, 0).unwrap()
}

fn now() -> DateTime<Utc> {
    at(2026, 9, 10)
}

/// A slide's event, hydrated as the carousel response carries it.
fn event(id: i64) -> Event {
    hydrate(
        EventRow {
            id,
            title: "Event".into(),
            category: Some("Business".into()),
            source_image_url: Some("https://example.com/poster.jpg".into()),
            school: Some("uwaterloo".into()),
            added_at: at(2026, 7, 1),
            ..EventRow::default()
        },
        vec![occurrence(id, at(2099, 7, 27), None)],
        None,
    )
    .unwrap()
}

fn occurrence(event_id: i64, start: DateTime<Utc>, end: Option<DateTime<Utc>>) -> Occurrence {
    Occurrence {
        id: Uuid::from_u128(event_id as u128),
        event_id,
        dtstart_utc: start,
        dtend_utc: end,
        duration: None,
        tz: Some("America/Toronto".into()),
    }
}

fn row(status: &str) -> BatchRow {
    BatchRow {
        id: Uuid::from_u128(1),
        account_key: "uwaterloo".into(),
        instagram_user_id: Some("17841476154506771".into()),
        batch_kind: "events".into(),
        school: "uwaterloo".into(),
        local_date: NaiveDate::from_ymd_opt(2026, 7, 26).unwrap(),
        window_start: Utc.with_ymd_and_hms(2026, 7, 25, 12, 30, 0).unwrap(),
        window_end: Utc.with_ymd_and_hms(2026, 7, 27, 12, 30, 0).unwrap(),
        status: status.into(),
        caption: "Caption".into(),
        caption_intro: String::new(),
        cover_body: "Body".into(),
        version: 3,
        error_message: None,
        meta_media_id: None,
        permalink: None,
        music_status: None,
        music_track: None,
        music_error: None,
        published_cover_url: None,
        published_outro_url: None,
        created_at: at(2026, 7, 26),
        updated_at: at(2026, 7, 26),
        published_at: None,
        school_id: 1,
        sticker_selections: json!({}),
    }
}

fn item(batch: u128, position: i32, event_id: Option<i32>, asset: Option<&str>) -> ItemRow {
    ItemRow {
        id: Uuid::from_u128(100 + position as u128),
        batch_id: Uuid::from_u128(batch),
        account_key: "uwaterloo".into(),
        event_id,
        position,
        published_asset_url: asset.map(Into::into),
        published_at: None,
        created_at: at(2026, 7, 26),
        updated_at: at(2026, 7, 26),
    }
}

fn events(list: Vec<Event>) -> HashMap<i64, Event> {
    list.into_iter().map(|event| (event.id, event)).collect()
}

#[test]
fn a_publishable_event_needs_a_category_a_poster_and_a_future() {
    // test_publishable_event_requires_image / _requires_category / _keeps_ongoing_and_recurring_events
    assert!(is_publishable(&event(1), now(), "events"));
    for image in [None, Some(""), Some("   ")] {
        let mut missing = event(1);
        missing.source_image_url = image.map(Into::into);
        assert!(!is_publishable(&missing, now(), "events"));
    }
    for category in [None, Some(""), Some("Events")] {
        let mut wrong = event(1);
        wrong.category = category.map(Into::into);
        assert!(!is_publishable(&wrong, now(), "events"));
    }
    let mut padded = event(1);
    padded.category = Some(" Business ".into());
    assert!(is_publishable(&padded, now(), "events"));
    let mut past = event(1);
    past.occurrences = vec![occurrence(1, at(2026, 9, 8), Some(at(2026, 9, 9)))];
    assert!(!is_publishable(&past, now(), "events"));
    past.occurrences = vec![occurrence(1, at(2026, 9, 8), Some(at(2026, 9, 11)))];
    assert!(is_publishable(&past, now(), "events"));
    past.occurrences = vec![
        occurrence(1, at(2026, 9, 8), Some(at(2026, 9, 9))),
        occurrence(1, at(2099, 7, 27), None),
    ];
    assert!(is_publishable(&past, now(), "events"));
}

#[test]
fn employer_carousels_take_only_employer_events() {
    // test_employer_hydration_filters_reclassified_events_only_before_publication
    let mut employer = event(1);
    assert!(!is_publishable(&employer, now(), "employers_on_campus"));
    employer.employers_on_campus = Some(true);
    assert!(is_publishable(&employer, now(), "employers_on_campus"));
}

#[test]
fn drafts_show_only_slides_they_could_post_and_published_batches_show_all() {
    // test_hydration_excludes_invalid_slides_only_from_drafts
    let mut no_image = event(2);
    no_image.source_image_url = None;
    let mut ended = event(3);
    ended.occurrences = vec![occurrence(3, at(2000, 1, 1), None)];
    let loaded = events(vec![event(1), no_image, ended]);
    let items = || {
        (1..=4)
            .map(|id| item(1, id, Some(id), None))
            .collect::<Vec<_>>()
    };
    for (status, expected) in [
        ("ready_for_review", vec![1]),
        ("failed", vec![1]),
        ("publishing", vec![1, 2, 3]),
        ("published", vec![1, 2, 3]),
    ] {
        let shown: Vec<i32> = visible_items(&row(status), items(), &loaded, now())
            .iter()
            .filter_map(|item| item.row.event_id)
            .collect();
        assert_eq!(shown, expected, "{status}");
    }
}

#[test]
fn a_deleted_event_keeps_its_posted_image_but_leaves_a_draft() {
    // test_deleted_event_does_not_block_batch_and_preserves_published_image
    let posted = || {
        vec![item(
            1,
            1,
            None,
            Some("https://example.com/published-slide.png"),
        )]
    };
    let published = visible_items(&row("published"), posted(), &HashMap::new(), now());
    assert_eq!(published.len(), 1);
    assert!(published[0].event.is_none());
    assert!(visible_items(&row("ready_for_review"), posted(), &HashMap::new(), now()).is_empty());
}

#[test]
fn draft_stickers_follow_the_slides_and_their_limit() {
    let stored: IndexMap<String, Vec<String>> = serde_json::from_value(json!({
        "2": ["a", "b", "c", "d", "e", "f"],
        "9": ["gone"],
        "1": ["free food"],
    }))
    .unwrap();
    let items = visible_items(
        &row("ready_for_review"),
        vec![item(1, 1, Some(1), None), item(1, 2, Some(2), None)],
        &events(vec![event(1), event(2)]),
        now(),
    );
    let stickers = draft_stickers(&stored, &items);
    assert_eq!(
        serde_json::to_value(&stickers).unwrap(),
        json!({"1": ["free food"], "2": ["a", "b", "c", "d"]})
    );
    assert_eq!(
        stickers.keys().collect::<Vec<_>>(),
        ["1", "2"],
        "in slide order"
    );
}

#[test]
fn list_counts_keep_posted_images_and_count_postable_slides() {
    // test_list_batches_attaches_item_counts_without_hydrating_details and
    // test_batch_counts_keep_published_images_but_ignore_deleted_draft_events
    let mut no_image = event(2);
    no_image.source_image_url = None;
    let loaded = events(vec![event(1), no_image]);
    let mut second = row("published");
    second.id = Uuid::from_u128(2);
    let rows = vec![row("ready_for_review"), second];
    let items = vec![
        item(1, 1, Some(1), None),
        item(1, 2, Some(2), None),
        item(1, 3, None, None),
        item(2, 1, Some(3), None),
        item(2, 2, None, Some("https://example.com/slide.png")),
    ];
    let counts = item_counts(&rows, &items, &loaded, now());
    assert_eq!(counts[&Uuid::from_u128(1)], (2, 1));
    assert_eq!(counts[&Uuid::from_u128(2)], (2, 0));
}

#[test]
fn the_outro_lists_upcoming_events_soonest_first_without_opted_out_clubs() {
    // test_outro_lists_the_upcoming_window_events_without_a_slide,
    // test_outro_leaves_out_excluded_clubs, test_outro_leaves_out_political_and_religious_events
    let mut ended = event(12);
    ended.occurrences = vec![occurrence(12, at(2000, 1, 1), None)];
    let mut sooner = event(13);
    sooner.occurrences = vec![occurrence(13, at(2099, 7, 1), None)];
    let mut opted_out = event(14);
    opted_out.ig_handle = Some(" @V1vaClub".into());
    let mut religious = event(15);
    religious.category = Some("Religion & Spirituality".into());
    let mut political = event(16);
    political.category = Some("Politics & Advocacy".into());
    let excluded = HashSet::from(["v1vaclub".to_owned()]);
    let others = outro_events(
        events(vec![
            event(11),
            ended,
            sooner,
            opted_out,
            religious,
            political,
        ]),
        &excluded,
        now(),
    );
    assert_eq!(
        others.iter().map(|event| event.id).collect::<Vec<_>>(),
        [13, 11]
    );
}

#[test]
fn batches_serialize_in_the_response_models_order() {
    let mut row = row("ready_for_review");
    row.sticker_selections = json!({"1": ["free food"]});
    let summary = serde_json::to_value(BatchSummary {
        row: row.clone(),
        item_count: 2,
        eligible_count: 1,
    })
    .unwrap();
    let keys: Vec<&String> = summary.as_object().unwrap().keys().collect();
    assert_eq!(
        keys,
        [
            "id",
            "account_key",
            "instagram_user_id",
            "batch_kind",
            "school",
            "local_date",
            "window_start",
            "window_end",
            "status",
            "caption",
            "caption_intro",
            "cover_body",
            "version",
            "error_message",
            "meta_media_id",
            "permalink",
            "music_status",
            "music_track",
            "music_error",
            "published_cover_url",
            "published_outro_url",
            "created_at",
            "updated_at",
            "published_at",
            "item_count",
            "eligible_count",
        ]
    );
    assert_eq!(summary["local_date"], "2026-07-26");
    assert_eq!(summary["window_end"], "2026-07-27T12:30:00Z");

    let items = visible_items(
        &row,
        vec![item(1, 1, Some(1), None)],
        &events(vec![event(1)]),
        now(),
    );
    let batch = Batch {
        sticker_selections: row.stored_stickers().unwrap(),
        row,
        new_event_count: 4,
        other_events: vec![event(11)],
        items,
    };
    let detail = serde_json::to_value(&batch).unwrap();
    let keys: Vec<&String> = detail.as_object().unwrap().keys().collect();
    assert_eq!(
        &keys[keys.len() - 5..],
        [
            "published_at",
            "sticker_selections",
            "new_event_count",
            "other_events",
            "items"
        ]
    );
    assert_eq!(detail["sticker_selections"], json!({"1": ["free food"]}));
    assert_eq!(detail["other_events"][0]["id"], 11);
    let item = &detail["items"][0];
    assert_eq!(
        item.as_object().unwrap().keys().collect::<Vec<_>>(),
        [
            "id",
            "batch_id",
            "account_key",
            "event_id",
            "position",
            "event",
            "published_asset_url",
            "published_at",
            "created_at",
            "updated_at"
        ]
    );
    assert_eq!(item["event"]["title"], "Event");
    assert_eq!(
        item["event"]["occurrences"][0].as_object().unwrap().len(),
        3
    );
}

#[test]
fn stickers_that_are_not_label_lists_fail_the_response() {
    let mut broken = row("published");
    broken.sticker_selections = json!({"1": "free food"});
    assert!(matches!(
        broken.stored_stickers(),
        Err(ApiError::Internal(_))
    ));
}
