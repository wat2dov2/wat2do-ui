//! The ticket routes' request bodies, checked the way pydantic checks a model
//! with `extra="forbid"`: every problem reported at once as a 422.

use serde_json::Value;
use uuid::Uuid;

use super::ticketing::TicketingInput;
use crate::api::body::{Body, Input, Str};
use crate::api::errors::ApiError;
use crate::api::validation::Limits;

/// The longest note a holder can send the club with a refund request.
pub const REFUND_NOTE_MAX_LENGTH: usize = 500;
/// The most tickets any one request names, before the controlbox's own limit.
const QUANTITY_LIMIT: i64 = 20;

fn required_int(body: &mut Body, name: &'static str, limits: Limits) -> Option<i64> {
    if body.has_field(name) {
        body.int_or(name, 0, limits)
    } else {
        body.missing(name);
        None
    }
}

/// A required, non-null boolean.
fn required_bool(body: &mut Body, name: &'static str) -> Option<bool> {
    match body.bool(name) {
        Input::Given(flag) => Some(flag),
        Input::Null => {
            body.type_error(name, "bool_type", "Input should be a valid boolean");
            None
        }
        Input::Missing => {
            if !body.has_field(name) {
                body.missing(name);
            }
            None
        }
    }
}

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
    let limit = i64::from(i32::MAX);
    let price_cents = required_int(&mut body, "price_cents", Limits::default().ge(0).le(limit));
    let capacity = optional_int(&mut body, "capacity", Limits::default().gt(0).le(limit));
    let paused = required_bool(&mut body, "paused");
    body.finish().map(|()| TicketingInput {
        price_cents: price_cents.unwrap_or_default() as i32,
        capacity: capacity.map(|capacity| capacity as i32),
        paused: paused.unwrap_or_default(),
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
    let quantity = required_int(
        &mut body,
        "quantity",
        Limits::default().ge(1).le(QUANTITY_LIMIT),
    );
    body.finish().map(|()| {
        (
            date.unwrap_or_default(),
            quantity.unwrap_or_default() as i32,
        )
    })
}

/// `TicketCheckInUpdate`: admit, or undo an admission.
pub fn check_in(mut body: Body) -> Result<bool, ApiError> {
    let checked_in = required_bool(&mut body, "checked_in");
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
    use serde_json::json;

    use super::*;
    use crate::api::body::Extra;

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
    fn ticketing_settings_have_no_limit_unless_given_one() {
        assert_eq!(
            ticketing(body(json!({"price_cents": 0, "paused": false}))).unwrap(),
            TicketingInput {
                price_cents: 0,
                capacity: None,
                paused: false
            }
        );
        assert_eq!(
            ticketing(body(
                json!({"price_cents": 1500, "capacity": 80, "paused": true})
            ))
            .unwrap(),
            TicketingInput {
                price_cents: 1500,
                capacity: Some(80),
                paused: true
            }
        );
        assert_eq!(
            ticketing(body(
                json!({"price_cents": 0, "capacity": null, "paused": false})
            ))
            .unwrap()
            .capacity,
            None
        );
    }

    #[test]
    fn ticketing_settings_refuse_bad_values_together() {
        let error = ticketing(body(
            json!({"price_cents": -1, "capacity": 0, "paused": false, "extra": 1}),
        ))
        .unwrap_err();
        assert_eq!(
            locs(error),
            [
                r#"["body","price_cents"]"#,
                r#"["body","capacity"]"#,
                r#"["body","extra"]"#
            ]
        );
        let missing = ticketing(body(json!({}))).unwrap_err();
        assert_eq!(
            locs(missing),
            [r#"["body","price_cents"]"#, r#"["body","paused"]"#]
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
