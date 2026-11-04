//! `backend/tests/routers/test_payouts.py` and the read and review cases of
//! `backend/tests/services/test_poster_payout_service.py`.

use chrono::TimeZone;
use serde_json::json;

use super::*;
use crate::api::routes::qr::tests::{bytes, fixtures, issues, json_headers};

fn payout(status: &str) -> PosterPayout {
    PosterPayout {
        id: Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa").unwrap(),
        user_id: Uuid::from_u128(1),
        period: NaiveDate::from_ymd_opt(2026, 6, 1).unwrap(),
        payout_email: "promoter@example.com".into(),
        rate_cents: 25,
        amount_cents: 250,
        scan_count: 10,
        status: status.into(),
        paid_at: None,
        notes: Some("Review".into()),
        reviewed_by: None,
        created_at: Utc.with_ymd_and_hms(2026, 7, 1, 1, 15, 0).unwrap(),
        updated_at: Utc.with_ymd_and_hms(2026, 7, 1, 1, 15, 0).unwrap()
            + chrono::Duration::microseconds(5),
    }
}

#[test]
fn status_bodies_fail_like_fastapi() {
    for (body, detail) in fixtures("status") {
        let result =
            Body::parse(&bytes(&body), &json_headers(), Extra::Forbid).and_then(|mut parsed| {
                read_status_update(&mut parsed);
                parsed.finish()
            });
        assert_eq!(issues(result), detail, "{body:?}");
    }
}

#[test]
fn selection_bodies_fail_like_fastapi() {
    for (body, detail) in fixtures("selection") {
        let result = read_selection(&Bytes::from(bytes(&body)), &json_headers()).map(|_| ());
        assert_eq!(issues(result), detail, "{body:?}");
    }
}

#[test]
fn notes_are_stripped_and_blank_notes_are_none() {
    let mut body = Body::from_value(
        json!({"status": "held", "notes": "  Confirm placement  "}),
        Extra::Forbid,
    );
    assert_eq!(
        read_status_update(&mut body),
        (Some("held".into()), Some("Confirm placement".into()))
    );
    let mut blank = Body::from_value(json!({"status": "held", "notes": "   "}), Extra::Forbid);
    assert_eq!(read_status_update(&mut blank), (Some("held".into()), None));
    // The length is checked before stripping, as pydantic does.
    let padded = format!(" {} ", "x".repeat(9_999));
    let mut long = Body::from_value(json!({"status": "held", "notes": padded}), Extra::Forbid);
    read_status_update(&mut long);
    assert!(long.finish().is_err());
}

#[test]
fn payout_responses_keep_pydantics_shape() {
    // test_list_own_payouts_is_scoped_to_user: no notes or reviewer for the promoter.
    let own = serde_json::to_value(UserPosterPayoutResponse::from(&payout(PENDING))).unwrap();
    assert_eq!(
        own.to_string(),
        r#"{"id":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","period":"2026-06-01","payout_email":"promoter@example.com","rate_cents":25,"amount_cents":250,"scan_count":10,"status":"pending","paid_at":null,"created_at":"2026-07-01T01:15:00Z"}"#
    );
    let admin = serde_json::to_value(PosterPayoutResponse::from(&payout(HELD))).unwrap();
    assert_eq!(
        admin.to_string(),
        r#"{"id":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","user_id":"00000000-0000-0000-0000-000000000001","period":"2026-06-01","payout_email":"promoter@example.com","rate_cents":25,"amount_cents":250,"scan_count":10,"status":"held","fraud_status":"flagged","paid_at":null,"notes":"Review","reviewed_by":null,"created_at":"2026-07-01T01:15:00Z","updated_at":"2026-07-01T01:15:00.000005Z"}"#
    );
}

#[test]
fn inverted_filter_ranges_are_refused() {
    // test_admin_payout_filters_reject_inverted_ranges
    let inverted = PayoutFilters {
        period_from: NaiveDate::from_ymd_opt(2026, 7, 1),
        period_to: NaiveDate::from_ymd_opt(2026, 6, 1),
        ..PayoutFilters::default()
    };
    assert!(
        matches!(inverted.check(), Err(ApiError::Validation { detail, .. }) if detail == INVALID_PAYOUT_FILTERS)
    );
    let amounts = PayoutFilters {
        minimum_amount_cents: Some(500),
        maximum_amount_cents: Some(100),
        ..PayoutFilters::default()
    };
    assert!(amounts.check().is_err());
    let equal = PayoutFilters {
        period_from: NaiveDate::from_ymd_opt(2026, 6, 1),
        period_to: NaiveDate::from_ymd_opt(2026, 6, 1),
        minimum_amount_cents: Some(5),
        maximum_amount_cents: Some(5),
        ..PayoutFilters::default()
    };
    assert!(equal.check().is_ok());
}

#[test]
fn email_filters_are_contains_patterns_like_postgrest() {
    let filter = |email: &str| PayoutFilters {
        payout_email: Some(email.into()),
        ..PayoutFilters::default()
    };
    assert_eq!(
        filter("waterloo").email_pattern().as_deref(),
        Some("%waterloo%")
    );
    assert_eq!(filter("a*b").email_pattern().as_deref(), Some("%a%b%"));
    assert_eq!(filter("").email_pattern(), None);
}

#[test]
fn exports_are_named_by_their_month() {
    // test_admin_can_export_selected_pending_payouts
    assert_eq!(
        export_filename(&[payout(PENDING)]),
        "poster-payouts-2026-06.csv"
    );
    let july = PosterPayout {
        period: NaiveDate::from_ymd_opt(2026, 7, 1).unwrap(),
        ..payout(PENDING)
    };
    assert_eq!(
        export_filename(&[payout(PENDING), july.clone(), payout(PENDING)]),
        "poster-payouts-export.csv"
    );
    assert_eq!(
        export_filename(&[july.clone(), july]),
        "poster-payouts-2026-07.csv"
    );
    assert_eq!(export_filename(&[]), "poster-payouts-export.csv");
}

#[test]
fn selections_keep_first_appearance_order_once() {
    let (a, b) = (Uuid::from_u128(2), Uuid::from_u128(1));
    assert_eq!(unique(&[a, b, a, a]), vec![a, b]);
}

#[test]
fn fraud_reasons_summarize_stored_flags() {
    // test_admin_payout_detail_summarizes_fraud_and_poster_contributions
    let flag =
        json!([{"code": "RAPID_VISITORS", "points": 60, "evidence": {"window_seconds": 60}}]);
    let reasons = fraud_reasons(&[flag.clone(), flag], &payout(HELD)).unwrap();
    assert_eq!(
        reasons,
        vec![PayoutFraudReason {
            code: "RAPID_VISITORS".into(),
            points: 60,
            affected_scan_count: 2,
            evidence: json!({"window_seconds": 60}),
        }]
    );
    // Distinct evidence is a distinct reason; key order does not matter.
    let scans = [
        json!([{"code": "A", "points": 1, "evidence": {"x": 1, "y": 2}}]),
        json!([{"evidence": {"y": 2, "x": 1}, "points": 1, "code": "A"}]),
        json!([{"code": "A", "points": 1, "evidence": {"x": 3}}]),
        json!([{"points": null}]),
        json!([]),
    ];
    let reasons = fraud_reasons(&scans, &payout(PENDING)).unwrap();
    assert_eq!(reasons.len(), 3);
    assert_eq!(reasons[0].affected_scan_count, 2);
    assert_eq!(
        reasons[2],
        PayoutFraudReason {
            code: "UNKNOWN".into(),
            points: 0,
            affected_scan_count: 1,
            evidence: json!({})
        }
    );
}

#[test]
fn a_hold_without_flags_shows_the_review_notes() {
    // test_admin_payout_detail_structures_manual_hold_reason
    let held = PosterPayout {
        notes: Some("Confirm placement with promoter".into()),
        ..payout(HELD)
    };
    assert_eq!(
        fraud_reasons(&[], &held).unwrap(),
        vec![PayoutFraudReason {
            code: "MANUAL_REVIEW".into(),
            points: 0,
            affected_scan_count: 0,
            evidence: json!({"review_notes": "Confirm placement with promoter"}),
        }]
    );
    assert!(fraud_reasons(&[], &payout(PENDING)).unwrap().is_empty());
    assert_eq!(
        fraud_reasons(&[], &payout(VOIDED)).unwrap()[0].code,
        "MANUAL_REVIEW"
    );
}
