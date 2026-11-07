//! The image parsing routes (`backend/tests/routers/test_ai.py`,
//! `tests/services/scraper/test_extractor.py`): the prompt the Python
//! extractor renders, every model answer in `testdata/extractions.json` read
//! to the same event form or position, and the routes' checks before any
//! database read.

use std::sync::Mutex;
use std::time::Duration;

use axum::body::Body as HttpBody;
use axum::http::{Method, Request, StatusCode, header};
use chrono::{DateTime, NaiveDate, Utc};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;

use super::extractor::*;
use crate::api::client_ip::Peer;
use crate::api::messages::{EVENT_IMAGE_NO_EVENT, POSITION_IMAGE_NO_POSITION};
use crate::api::{AppState, router};
use crate::schools::School;
use crate::settings::{Settings, test_settings};

/// A model that answers `answer` and remembers what it was asked.
struct Fake {
    answer: Option<String>,
    asked: Mutex<Vec<(String, String, Vec<String>)>>,
}

impl Fake {
    fn new(answer: Option<&str>) -> Self {
        Self {
            answer: answer.map(str::to_owned),
            asked: Mutex::new(Vec::new()),
        }
    }
}

impl Completion for Fake {
    async fn complete(&self, system: &str, prompt: &str, image_urls: &[String]) -> Option<String> {
        self.asked.lock().unwrap().push((
            system.to_owned(),
            prompt.to_owned(),
            image_urls.to_vec(),
        ));
        self.answer.clone()
    }
}

fn waterloo() -> School {
    School {
        id: 1,
        slug: "uwaterloo".into(),
        name: "University of Waterloo".into(),
        timezone: "America/Toronto".into(),
        semester_start: NaiveDate::from_ymd_opt(2026, 9, 1),
        semester_end: NaiveDate::from_ymd_opt(2026, 12, 22),
        recipient_id: None,
    }
}

#[test]
fn prompts_render_like_the_python_extractor() {
    let fixtures: Vec<Value> = serde_json::from_str(include_str!("testdata/prompts.json")).unwrap();
    for fixture in &fixtures {
        let inputs = &fixture["inputs"];
        let text = |name: &str| inputs[name].as_str().unwrap();
        let prompt = build_prompt(&PromptInputs {
            caption: inputs["caption_text"].as_str(),
            image_count: inputs["image_urls"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|url| url.as_str() != Some(""))
                .count(),
            school: text("school"),
            local_tz_key: text("local_tz_key"),
            current_date: text("current_date"),
            current_day: text("current_day"),
            post_date: text("post_date"),
            post_day: text("post_day"),
            post_time: text("post_time"),
            semester_line: text("semester_line"),
        });
        assert_eq!(prompt, fixture["prompt"].as_str().unwrap());
    }
    assert_eq!(fixtures.len(), 2);
}

fn event_outcome(content: &Result<PostContent, ExtractionFailed>, now: DateTime<Utc>) -> Value {
    let Ok(content) = content else {
        return json!({"error": "failed"});
    };
    match content
        .events
        .first()
        .and_then(|event| event_form(event, "America/Toronto", now))
    {
        None => json!({"error": EVENT_IMAGE_NO_EVENT}),
        Some(form) => json!({
            "title": form.title,
            "description": form.description,
            "occurrences": form.occurrences,
            "location": form.location,
            "category": form.category,
            "price": form.price,
            "food": form.food,
            "registration": form.registration,
        }),
    }
}

fn position_outcome(content: &Result<PostContent, ExtractionFailed>) -> Value {
    let Ok(content) = content else {
        return json!({"error": "failed"});
    };
    match content.positions.first() {
        None => json!({"error": POSITION_IMAGE_NO_POSITION}),
        Some(position) => json!({
            "title": position.title,
            "description": position.description,
            "position_type": position.position_type,
            "requirements": position.requirements,
            "commitment": position.commitment,
            "compensation": position.compensation,
            "is_paid": position.is_paid,
            "location": position.location,
            "contact_email": position.contact_email,
            "deadline_date": position.deadline_date.map(|date| date.format("%Y-%m-%d").to_string()),
            "deadline_at": position.deadline_at,
        }),
    }
}

#[tokio::test]
async fn model_answers_read_like_python() {
    let corpus: Value = serde_json::from_str(include_str!("testdata/extractions.json")).unwrap();
    let now: DateTime<Utc> = corpus["now"].as_str().unwrap().parse().unwrap();
    let urls = vec!["data:image/png;base64,aW1n".to_owned()];
    let cases = corpus["cases"].as_array().unwrap();
    for (index, case) in cases.iter().enumerate() {
        let answer = case["answer"].as_str().unwrap();
        let model = Fake::new(Some(answer));
        let content = extract_post_content(&waterloo(), &urls, now, &model).await;
        assert_eq!(event_outcome(&content, now), case["event"], "{answer}");
        assert_eq!(position_outcome(&content), case["position"], "{answer}");
        if index == 0 {
            // The prompt the Python extractor sent for the same poster and time.
            let asked = model.asked.lock().unwrap()[0].clone();
            assert_eq!(asked.0, corpus["system"].as_str().unwrap());
            assert_eq!(asked.1, corpus["prompt"].as_str().unwrap());
            assert_eq!(json!(asked.2), corpus["urls"]);
        }
    }
    assert!(cases.len() > 70);
}

#[tokio::test]
async fn a_failed_call_is_a_failed_extraction() {
    // test_extraction_failure_is_distinct_from_a_valid_non_event
    let now = Utc::now();
    let failed = Fake::new(None);
    assert_eq!(
        extract_post_content(&waterloo(), &["x".to_owned()], now, &failed).await,
        Err(ExtractionFailed)
    );
    // test_extraction_of_a_valid_non_event_is_empty
    let other = Fake::new(Some(
        r#"{"content_type": "other", "events": [], "positions": []}"#,
    ));
    assert_eq!(
        extract_post_content(&waterloo(), &["x".to_owned()], now, &other).await,
        Ok(PostContent::default())
    );
    // Blank image URLs are neither counted nor sent.
    let model = Fake::new(Some("{}"));
    let _ = extract_post_content(&waterloo(), &[String::new(), "y".to_owned()], now, &model).await;
    let asked = model.asked.lock().unwrap()[0].clone();
    assert_eq!(asked.2, ["y"]);
    assert!(asked.1.contains("(1 images)"));
}

#[test]
fn model_json_tolerates_fences_and_notes() {
    // test_parse_model_json_*
    assert_eq!(parse_model_json("[1, 2]"), Some(json!([1, 2])));
    assert_eq!(parse_model_json("{\"a\": 1}"), Some(json!({"a": 1})));
    assert_eq!(parse_model_json("```json\n[1]\n```"), Some(json!([1])));
    assert_eq!(parse_model_json("```\n{}\n```"), Some(json!({})));
    assert_eq!(
        parse_model_json("[{\"a\": 1}]\nNote: inferred the year."),
        Some(json!([{"a": 1}]))
    );
    assert_eq!(parse_model_json("no json here"), None);
    assert_eq!(parse_model_json(""), None);
    assert_eq!(parse_model_json("``````"), None);
    assert_eq!(parse_model_json("null"), Some(Value::Null));
}

#[test]
fn the_event_form_converts_to_the_posters_zone() {
    // test_parse_event_image_authenticated: 22:00Z on April 10 is 18:00 in Toronto.
    let event = ExtractedEvent {
        title: "Mock Image Event".into(),
        description: "Mock Description".into(),
        location: "McMaster Student Centre, room 201".into(),
        price: Some(0.0),
        food: vec!["Samosas".into(), "Pizza".into()],
        registration: false,
        occurrences: vec![ExtractedOccurrence {
            dtstart_utc: crate::api::validation::parse_datetime("2026-04-10T22:00:00Z").unwrap(),
            dtend_utc: None,
            duration: None,
            tz: Some("America/Toronto".into()),
        }],
        category: Some("Games & Recreation".into()),
    };
    let form = event_form(&event, "UTC", Utc::now()).unwrap();
    assert_eq!(form.occurrences[0].dtstart_local, "2026-04-10T18:00");
    assert_eq!(form.occurrences[0].dtend_local, "");
    assert_eq!(form.food, ["Samosas", "Pizza"]);
    assert_eq!(form.category, "Games & Recreation");
}

fn state() -> AppState {
    let settings: &'static Settings = Box::leak(Box::new(test_settings(&[])));
    // Nothing listens here: a test that reached the database would fail.
    let db = crate::db::connect_lazy(
        "postgres://localhost:1/none".parse().unwrap(),
        1,
        Duration::from_secs(1),
        Duration::from_millis(200),
        false,
    );
    AppState::new(settings, db, None).unwrap()
}

async fn post(
    path: &str,
    peer: &str,
    content_type: Option<&str>,
    body: &[u8],
) -> (StatusCode, Value) {
    let mut builder = Request::builder()
        .method(Method::POST)
        .uri(path)
        .header(header::HOST, "testserver");
    if let Some(content_type) = content_type {
        builder = builder.header(header::CONTENT_TYPE, content_type);
    }
    let mut request = builder.body(HttpBody::from(body.to_vec())).unwrap();
    request.extensions_mut().insert(Peer(peer.to_owned()));
    let response = crate::api::app(router(state()))
        .oneshot(request)
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

const FORM: &str = "multipart/form-data; boundary=b";

fn poster() -> Vec<u8> {
    b"--b\r\nContent-Disposition: form-data; name=\"file\"; filename=\"p.jpg\"\r\nContent-Type: image/jpeg\r\n\r\nimage\r\n--b--\r\n".to_vec()
}

#[tokio::test]
async fn the_campus_and_the_poster_are_required() {
    // test_event_image_requires_registered_campus (the 422 half)
    for path in ["/ai/parse-event-image", "/ai/parse-position-image"] {
        let (status, body) = post(path, "10.0.0.1", Some(FORM), &poster()).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(
            body,
            json!({"detail": [{"type": "missing", "loc": ["query", "school"], "msg": "Field required", "input": null}]})
        );
        let (status, body) = post(&format!("{path}?school="), "10.0.0.2", None, b"").await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(
            body,
            json!({"detail": [
                {"type": "string_too_short", "loc": ["query", "school"], "msg": "String should have at least 1 character", "input": "", "ctx": {"min_length": 1}},
                {"type": "missing", "loc": ["body", "file"], "msg": "Field required", "input": null},
            ]})
        );
    }
}

#[tokio::test]
async fn a_malformed_form_is_refused_before_anything_else() {
    let (status, body) = post(
        "/ai/parse-event-image?school=uwaterloo",
        "10.0.0.3",
        Some("multipart/form-data"),
        b"x",
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body, json!({"detail": "Missing boundary in multipart."}));
}

#[tokio::test]
async fn both_routes_share_one_limit_per_visitor() {
    // test_parse_event_image_anonymous_rate_limit
    let budget = crate::controlbox::RATE_LIMITS.default.maximum_requests;
    for attempt in 0..budget {
        let path = if attempt % 2 == 0 {
            "/ai/parse-event-image"
        } else {
            "/ai/parse-position-image"
        };
        let (status, _) = post(path, "10.0.0.9", Some(FORM), &poster()).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    }
    let (status, body) = post("/ai/parse-event-image", "10.0.0.9", Some(FORM), &poster()).await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(body["detail"], crate::api::messages::RATE_LIMIT_EXCEEDED);
    // Another visitor is unaffected.
    let (status, _) = post("/ai/parse-event-image", "10.0.0.10", Some(FORM), &poster()).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}
