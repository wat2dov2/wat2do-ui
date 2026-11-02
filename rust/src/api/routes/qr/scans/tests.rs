//! `backend/tests/services/test_qr_code_service.py` and the scan cases of
//! `backend/tests/routers/test_qr.py`, plus the edge cases they missed.

use chrono::{TimeZone, Utc};
use serde_json::json;

use super::*;
use crate::settings::test_settings;

fn settings() -> Settings {
    test_settings(&[
        ("POSTER_HASH_SECRET", "hash-secret"),
        ("POSTER_CONFIRMATION_SECRET", "confirmation-secret"),
    ])
}

fn poster(program: &str) -> QrCodeResponse {
    QrCodeResponse {
        id: "poster-1".into(),
        name: "Poster".into(),
        description: None,
        destination_type: "events-list".into(),
        destination_id: None,
        filters: Some(json!({"school": "uwaterloo"})),
        created_at: Utc::now(),
        created_by: Uuid::nil().to_string(),
        is_active: true,
        program: program.into(),
        latest_scan: None,
        poster_template_id: None,
        image_url: None,
        latitude: 0.0,
        longitude: 0.0,
    }
}

#[test]
fn hashes_match_python_and_are_domain_separated() {
    let settings = settings();
    // hmac.new(b"hash-secret", b"visitor:v1:visitor", sha256).hexdigest()
    let visitor = hash_visitor_token("visitor", &settings).unwrap();
    assert_eq!(
        visitor,
        "3b9b9f0bfd8105ad43873adfd2a0c6cb8ae26e517289430d441b69132ed7682c"
    );
    assert_eq!(
        hash_client_ip("203.0.113.5", &settings).unwrap(),
        "2b6935ab3eb591eb8d0c5bf483c9e550af10743c93ac303e76143b04c4a13028"
    );
    assert_ne!(visitor, hash_client_ip("visitor", &settings).unwrap());
    assert!(!visitor.contains("visitor"));
}

#[test]
fn hashing_without_a_secret_is_a_500() {
    let settings = test_settings(&[]);
    assert!(matches!(
        hash_client_ip("1.2.3.4", &settings),
        Err(ApiError::Internal(_))
    ));
    assert!(matches!(
        create_confirmation_token(Uuid::nil(), Utc::now(), &settings),
        Err(ApiError::Internal(_))
    ));
    assert!(matches!(
        verify_confirmation_token("x.y", Utc::now(), &settings),
        Err(ApiError::Internal(_))
    ));
}

#[test]
fn confirmation_tokens_match_python_and_open_after_the_landing_delay() {
    let settings = settings();
    let scan = Uuid::parse_str("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa").unwrap();
    let issued = Utc.with_ymd_and_hms(2026, 7, 25, 12, 0, 0).unwrap()
        + chrono::Duration::microseconds(500_000);
    let token = create_confirmation_token(scan, issued, &settings).unwrap();
    assert_eq!(
        token,
        "MTphYWFhYWFhYS1hYWFhLTRhYWEtOGFhYS1hYWFhYWFhYWFhYWE6MTc4NDk4MDgwNjoxNzg0OTgxNzAw.QP9fSwoHU-SN9isDY8xm8Uhb6kqeLmUe1s6GK3UKtIk"
    );
    let delay = chrono::Duration::seconds(PROMOTER_PROGRAM.landing_confirmation_seconds);
    // Not yet: the not-before time is rounded up to a whole second.
    assert_eq!(
        verify_confirmation_token(&token, issued, &settings).unwrap(),
        None
    );
    assert_eq!(
        verify_confirmation_token(&token, issued + delay, &settings).unwrap(),
        None
    );
    let open = issued + delay + chrono::Duration::seconds(1);
    assert_eq!(
        verify_confirmation_token(&token, open, &settings).unwrap(),
        Some(scan)
    );
    // Expired after the confirmation window (rounded down).
    let window = chrono::Duration::minutes(PROMOTER_PROGRAM.confirmation_token_minutes);
    assert_eq!(
        verify_confirmation_token(&token, issued + window, &settings).unwrap(),
        None
    );
    // Tampered, truncated or foreign tokens are refused, never an error.
    for bad in [
        format!("{token}tampered"),
        token.replace('.', ""),
        "".to_owned(),
        ".".to_owned(),
        "%%%.%%%".to_owned(),
        token.split('.').next().unwrap().to_owned() + ".AAAA",
    ] {
        assert_eq!(
            verify_confirmation_token(&bad, open, &settings).unwrap(),
            None,
            "{bad}"
        );
    }
    let other = test_settings(&[("POSTER_CONFIRMATION_SECRET", "other")]);
    assert_eq!(
        verify_confirmation_token(&token, open, &other).unwrap(),
        None
    );
}

#[test]
fn signed_payloads_must_name_version_one_and_a_scan() {
    let settings = settings();
    let secret = settings.poster_confirmation_secret.as_bytes().to_vec();
    let forge = |payload: &str| {
        format!(
            "{}.{}",
            encode_token(payload.as_bytes()),
            encode_token(&sign(&secret, payload.as_bytes()))
        )
    };
    let now = Utc.with_ymd_and_hms(2026, 7, 25, 12, 0, 0).unwrap();
    let stamp = now.timestamp();
    let valid = forge(&format!("1:{}:{}:{}", Uuid::nil(), stamp - 1, stamp + 1));
    assert_eq!(
        verify_confirmation_token(&valid, now, &settings).unwrap(),
        Some(Uuid::nil())
    );
    for payload in [
        format!("2:{}:{}:{}", Uuid::nil(), stamp - 1, stamp + 1),
        format!("1:not-a-uuid:{}:{}", stamp - 1, stamp + 1),
        format!("1:{}:soon:{}", Uuid::nil(), stamp + 1),
        format!("1:{}:{}", Uuid::nil(), stamp - 1),
    ] {
        assert_eq!(
            verify_confirmation_token(&forge(&payload), now, &settings).unwrap(),
            None
        );
    }
    // The bounds are inclusive.
    let edge = forge(&format!("1:{}:{stamp}:{stamp}", Uuid::nil()));
    assert_eq!(
        verify_confirmation_token(&edge, now, &settings).unwrap(),
        Some(Uuid::nil())
    );
}

#[test]
fn token_decoding_is_as_lenient_as_python() {
    assert_eq!(decode_token("YWJj"), Some(b"abc".to_vec()));
    assert_eq!(decode_token("YWI"), Some(b"ab".to_vec()));
    assert_eq!(decode_token("Y!W!J!j"), Some(b"abc".to_vec()));
    assert_eq!(decode_token("Y"), None);
    assert_eq!(decode_token("_-8"), Some(vec![0xff, 0xef]));
}

#[test]
fn user_agents_keep_only_broad_families() {
    for (agent, expected) in [
        (
            Some("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit Safari/604.1"),
            (Some("Safari"), Some("iOS")),
        ),
        (
            Some("Mozilla/5.0 (Windows NT 10.0) AppleWebKit Chrome/126.0 Safari/537.36"),
            (Some("Chrome"), Some("Windows")),
        ),
        (
            Some("Mozilla/5.0 (Windows NT 10.0) Chrome/126.0 Safari/537.36 Edg/126.0"),
            (Some("Edge"), Some("Windows")),
        ),
        (
            Some("Mozilla/5.0 (Linux; Android 14) Chrome/126.0 Mobile OPR/80"),
            (Some("Opera"), Some("Android")),
        ),
        (
            Some("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Gecko Firefox/127.0"),
            (Some("Firefox"), Some("macOS")),
        ),
        (Some("curl/8.0"), (Some("Other"), Some("Other"))),
        (Some("X11; LINUX"), (Some("Other"), Some("Linux"))),
        (Some(""), (None, None)),
        (None, (None, None)),
    ] {
        assert_eq!(parse_user_agent(agent), expected, "{agent:?}");
    }
}

#[test]
fn the_visitor_cookie_matches_starlette() {
    let settings = test_settings(&[("COOKIE_DOMAIN", ".wat2do.io")]);
    assert_eq!(
        visitor_cookie("abc-_x", &settings),
        "wat2do_poster_visitor=abc-_x; Domain=.wat2do.io; HttpOnly; Max-Age=63072000; Path=/qr; SameSite=lax; Secure"
    );
    let local = test_settings(&[
        ("COOKIE_SECURE", "false"),
        ("POSTER_VISITOR_COOKIE_PATH", "/api/qr"),
    ]);
    assert_eq!(
        visitor_cookie("abc", &local),
        "wat2do_poster_visitor=abc; HttpOnly; Max-Age=63072000; Path=/api/qr; SameSite=lax"
    );
    let production = test_settings(&[("COOKIE_SECURE", "false"), ("ENVIRONMENT", "production")]);
    assert!(visitor_cookie("abc", &production).ends_with("; Secure"));
    let token = new_visitor_token();
    assert_eq!(token.len(), 43);
    assert!(
        token
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    );
    assert_ne!(token, new_visitor_token());
}

#[test]
fn cookies_parse_like_starlette() {
    let headers = |value: &str| {
        let mut map = HeaderMap::new();
        map.insert(header::COOKIE, value.parse().unwrap());
        map
    };
    assert_eq!(
        request_cookie(
            &headers("a=1; wat2do_poster_visitor=tok ; b=2"),
            POSTER_VISITOR_COOKIE
        ),
        Some("tok".into())
    );
    assert_eq!(
        request_cookie(
            &headers("wat2do_poster_visitor=one; wat2do_poster_visitor=two"),
            POSTER_VISITOR_COOKIE
        ),
        Some("two".into())
    );
    assert_eq!(
        request_cookie(
            &headers("wat2do_poster_visitor=\"a\\\"b\\054c\""),
            POSTER_VISITOR_COOKIE
        ),
        Some("a\"b,c".into())
    );
    assert_eq!(
        request_cookie(&headers("other=1"), POSTER_VISITOR_COOKIE),
        None
    );
    // An empty or over-long token is not a visitor.
    assert_eq!(visitor_token(&headers("wat2do_poster_visitor=")), None);
    let long = format!("wat2do_poster_visitor={}", "a".repeat(257));
    assert_eq!(visitor_token(&headers(&long)), None);
    let longest = format!("wat2do_poster_visitor={}", "a".repeat(256));
    assert!(visitor_token(&headers(&longest)).is_some());
    assert_eq!(unquote("\""), "\"");
}

#[test]
fn unplaced_promoter_scans_need_a_location() {
    // test_unplaced_promoter_scan_without_coordinates_requests_location
    let promoter = poster("promoter");
    assert!(matches!(
        plan_scan(&promoter, None, None),
        Err(ApiError::Validation { detail, .. }) if detail == "requires_location"
    ));
    assert!(plan_scan(&promoter, Some(1.0), None).is_err());
    // test_unplaced_promoter_scan_records_coordinate_attempt
    for (latitude, longitude) in [(0.0, 0.0), (43.4723, -80.5449)] {
        assert_eq!(
            plan_scan(&promoter, Some(latitude), Some(longitude)).unwrap(),
            ScanPlan::Record {
                latitude: Some(latitude),
                longitude: Some(longitude)
            }
        );
    }
}

#[test]
fn placed_promoter_scans_cannot_move_the_poster() {
    let placed = QrCodeResponse {
        latitude: 43.4723,
        longitude: -80.5449,
        ..poster("promoter")
    };
    assert_eq!(
        plan_scan(&placed, Some(45.5019), Some(-73.5674)).unwrap(),
        ScanPlan::Record {
            latitude: None,
            longitude: None
        }
    );
    assert_eq!(
        plan_scan(&placed, None, None).unwrap(),
        ScanPlan::Record {
            latitude: None,
            longitude: None
        }
    );
}

#[test]
fn standard_posters_need_a_location_only_for_the_first_scan() {
    let new = QrCodeResponse {
        destination_type: "event".into(),
        destination_id: Some("42".into()),
        ..poster("standard")
    };
    assert!(plan_scan(&new, None, None).is_err());
    let scanned = QrCodeResponse {
        latest_scan: Some(Utc::now()),
        ..new.clone()
    };
    assert_eq!(
        plan_scan(&scanned, None, None).unwrap(),
        ScanPlan::Record {
            latitude: None,
            longitude: None
        }
    );
    assert_eq!(
        plan_scan(&scanned, Some(1.0), Some(2.0)).unwrap(),
        ScanPlan::Record {
            latitude: Some(1.0),
            longitude: Some(2.0)
        }
    );
    // test_resolve_historical_inactive_qr_redirects_without_recording
    let archived = QrCodeResponse {
        is_active: false,
        ..new
    };
    assert_eq!(
        plan_scan(&archived, None, None).unwrap(),
        ScanPlan::RedirectOnly
    );
}

#[test]
fn redirects_match_python() {
    let event = QrCodeResponse {
        destination_type: "event".into(),
        destination_id: Some("99".into()),
        filters: None,
        ..poster("standard")
    };
    assert_eq!(
        serde_json::to_string(&build_redirect(&event, None)).unwrap(),
        r#"{"destination_type":"event","destination_id":99,"filters":null,"query_params":null,"scan_confirmation_token":null}"#
    );
    let promoter = build_redirect(&poster("promoter"), Some("signed".into()));
    assert_eq!(
        serde_json::to_string(&promoter).unwrap(),
        r#"{"destination_type":"events-list","destination_id":null,"filters":{"school":"uwaterloo"},"query_params":{"utm_source":"poster","poster_id":"poster-1"},"scan_confirmation_token":"signed"}"#
    );
    let url = QrCodeResponse {
        destination_type: "custom-url".into(),
        destination_id: Some("https://example.com".into()),
        ..poster("standard")
    };
    assert_eq!(
        build_redirect(&url, None).destination_id,
        Some(DestinationId::Text("https://example.com".into()))
    );
}

#[test]
fn event_ids_coerce_like_python_int() {
    for (text, digits) in [
        ("42", Some("42")),
        (" 42 ", Some("42")),
        ("+7", Some("7")),
        ("-0", Some("0")),
        ("007", Some("7")),
        ("1_000", Some("1000")),
        (
            "123456789012345678901234567890",
            Some("123456789012345678901234567890"),
        ),
        ("42.0", None),
        ("abc", None),
        ("", None),
        ("1__0", None),
        ("_1", None),
    ] {
        assert_eq!(integer_digits(text).as_deref(), digits, "{text:?}");
    }
    let event = QrCodeResponse {
        destination_type: "event".into(),
        destination_id: Some("not-a-number".into()),
        ..poster("standard")
    };
    assert_eq!(
        build_redirect(&event, None).destination_id,
        Some(DestinationId::Text("not-a-number".into()))
    );
    let big = serde_json::to_string(&DestinationId::Integer(
        "123456789012345678901234567890".into(),
    ))
    .unwrap();
    assert_eq!(big, "123456789012345678901234567890");
}

#[test]
fn user_agents_are_truncated_to_512_characters() {
    let mut headers = HeaderMap::new();
    headers.insert(header::USER_AGENT, "a".repeat(600).parse().unwrap());
    assert_eq!(user_agent(&headers).unwrap().len(), 512);
    assert_eq!(user_agent(&HeaderMap::new()), None);
}
