//! The ticket routes' request bodies, checked the way pydantic checks a model
//! with `extra="forbid"`: every problem reported at once as a 422.

use serde_json::Value;
use uuid::Uuid;

use super::ticketing::{ReleaseInput, TicketingInput};
use crate::api::body::{Body, Extra, Input, Str};
use crate::api::errors::ApiError;
use crate::api::validation::Limits;

/// The longest note a holder can send the club with a refund request.
pub const REFUND_NOTE_MAX_LENGTH: usize = 500;
/// The most tickets any one request names, before the controlbox's own limit.
const QUANTITY_LIMIT: i64 = 20;

/// An `int | None` field: null or missing reads as `None`.
fn optional_int(body: &mut Body, name: &'static str, limits: Limits) -> Option<i64> {
    match body.raw_copy(name) {
        None | Some(Value::Null) => {
            let _ = body.raw(name);
            None
        }
        Some(_) => body.int_or(name, 0, limits),
    }
}

/// `EventTicketingUpdate`.
pub fn ticketing(mut body: Body) -> Result<TicketingInput, ApiError> {
    let releases = match body.list("releases", 1, usize::MAX, |body, loc, value| {
        body.nested_item(loc, value, Extra::Forbid, release)
    }) {
        Input::Given(releases) => Some(releases),
        Input::Missing if !body.has_field("releases") => {
            body.missing("releases");
            None
        }
        Input::Null => {
            body.type_error("releases", "list_type", "Input should be a valid list");
            None
        }
        Input::Missing => None,
    };
    let paused = body.required_bool("paused");
    let dates = body.required_uuid_list("event_date_ids", 1, usize::MAX);
    body.finish().map(|()| TicketingInput {
        releases: releases.unwrap_or_default(),
        paused: paused.unwrap_or_default(),
        dates: dates.unwrap_or_default(),
    })
}

/// `TicketReleaseInput`.
fn release(body: &mut Body) -> Option<ReleaseInput> {
    let limit = i64::from(i32::MAX);
    let id = body.uuid("id");
    let on_sale_at = match body.aware_datetime("on_sale_at") {
        Input::Given(at) => Some(at),
        Input::Missing if !body.has_field("on_sale_at") => {
            body.missing("on_sale_at");
            None
        }
        Input::Null => {
            body.type_error(
                "on_sale_at",
                "datetime_type",
                "Input should be a valid datetime",
            );
            None
        }
        Input::Missing => None,
    };
    let quantity = optional_int(body, "quantity", Limits::default().gt(0).le(limit));
    let price_cents = body.required_int("price_cents", Limits::default().ge(0).le(limit));
    body.check_extras();
    if body.has_issues() {
        return None;
    }
    Some(ReleaseInput {
        id: id.value(),
        on_sale_at: on_sale_at?,
        quantity: quantity.map(|quantity| quantity as i32),
        price_cents: price_cents? as i32,
    })
}

/// `FreeTicketCreate`: the date to take a free ticket to.
pub fn free_ticket(mut body: Body) -> Result<Uuid, ApiError> {
    let date = body.required_uuid("event_date_id");
    body.finish().map(|()| date.unwrap_or_default())
}

/// `TicketCheckoutCreate`: the date and how many tickets.
pub fn checkout(mut body: Body) -> Result<(Uuid, i32), ApiError> {
    let date = body.required_uuid("event_date_id");
    let quantity = body.required_int("quantity", Limits::default().ge(1).le(QUANTITY_LIMIT));
    body.finish().map(|()| {
        (
            date.unwrap_or_default(),
            quantity.unwrap_or_default() as i32,
        )
    })
}

/// `TicketCheckInUpdate`: admit, or undo an admission.
pub fn check_in(mut body: Body) -> Result<bool, ApiError> {
    let checked_in = body.required_bool("checked_in");
    body.finish().map(|()| checked_in.unwrap_or_default())
}

/// `TicketRefundRequestCreate`: an optional note for the club.
pub fn refund_request(mut body: Body) -> Result<Option<String>, ApiError> {
    let note = match body.string("note", &Str::new().max(REFUND_NOTE_MAX_LENGTH)) {
        Input::Given(note) => Some(note),
        _ => None,
    };
    body.finish().map(|()| note)
}

#[cfg(test)]
mod tests {
    use chrono::{TimeZone, Utc};
    use serde_json::json;

    use super::*;

    fn body(value: Value) -> Body {
        Body::from_json(value, Extra::Forbid).unwrap()
    }

    fn locs(error: ApiError) -> Vec<String> {
        match error {
            ApiError::RequestValidation(issues) => issues
                .iter()
                .map(|issue| serde_json::to_value(issue).unwrap()["loc"].to_string())
                .collect(),
            other => panic!("expected a 422, got {other:?}"),
        }
    }

    #[test]
    fn ticketing_settings_read_each_release() {
        let date = Uuid::from_u128(5);
        let saved = Uuid::from_u128(9);
        let parsed = ticketing(body(json!({
            "releases": [
                {"on_sale_at": "2026-11-10T14:00:00Z", "quantity": 50, "price_cents": 500, "id": saved},
                {"on_sale_at": "2026-11-15T14:00:00-05:00", "quantity": null, "price_cents": 800}
            ],
            "paused": true,
            "event_date_ids": [date]
        })))
        .unwrap();
        assert_eq!(
            parsed,
            TicketingInput {
                releases: vec![
                    ReleaseInput {
                        id: Some(saved),
                        on_sale_at: Utc.with_ymd_and_hms(2026, 11, 10, 14, 0, 0).unwrap(),
                        quantity: Some(50),
                        price_cents: 500,
                    },
                    ReleaseInput {
                        id: None,
                        on_sale_at: Utc.with_ymd_and_hms(2026, 11, 15, 19, 0, 0).unwrap(),
                        quantity: None,
                        price_cents: 800,
                    },
                ],
                paused: true,
                dates: vec![date],
            }
        );
    }

    #[test]
    fn ticketing_settings_refuse_bad_values_together() {
        let error = ticketing(body(json!({
            "releases": [{"on_sale_at": "soon", "quantity": 0, "price_cents": -1, "extra": 1}],
            "paused": false,
            "event_date_ids": [],
            "extra": 1
        })))
        .unwrap_err();
        assert_eq!(
            locs(error),
            [
                r#"["body","releases",0,"on_sale_at"]"#,
                r#"["body","releases",0,"quantity"]"#,
                r#"["body","releases",0,"price_cents"]"#,
                r#"["body","releases",0,"extra"]"#,
                r#"["body","event_date_ids"]"#,
                r#"["body","extra"]"#
            ]
        );
        let missing = ticketing(body(json!({"releases": []}))).unwrap_err();
        assert_eq!(
            locs(missing),
            [
                r#"["body","releases"]"#,
                r#"["body","paused"]"#,
                r#"["body","event_date_ids"]"#
            ]
        );
    }

    #[test]
    fn a_checkout_names_a_date_and_a_sensible_quantity() {
        let date = Uuid::from_u128(5);
        assert_eq!(
            checkout(body(
                json!({"event_date_id": date.to_string(), "quantity": 2})
            ))
            .unwrap(),
            (date, 2)
        );
        assert!(
            checkout(body(
                json!({"event_date_id": date.to_string(), "quantity": 0})
            ))
            .is_err()
        );
        assert!(checkout(body(json!({"event_date_id": "nope", "quantity": 1}))).is_err());
        assert!(free_ticket(body(json!({"event_date_id": date.to_string()}))).is_ok());
        assert!(free_ticket(body(json!({}))).is_err());
    }

    #[test]
    fn check_ins_say_which_way_and_notes_stay_short() {
        assert!(check_in(body(json!({"checked_in": true}))).unwrap());
        assert!(!check_in(body(json!({"checked_in": false}))).unwrap());
        assert!(check_in(body(json!({}))).is_err());
        assert_eq!(refund_request(body(json!({}))).unwrap(), None);
        assert_eq!(
            refund_request(body(json!({"note": "New date clashes"}))).unwrap(),
            Some("New date clashes".to_owned())
        );
        assert!(refund_request(body(json!({"note": "x".repeat(501)}))).is_err());
    }
}
