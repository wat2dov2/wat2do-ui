//! The ticket routes' request bodies, checked the way pydantic checks a model
//! with `extra="forbid"`: every problem reported at once as a 422.

use serde_json::Value;
use uuid::Uuid;

use super::ticketing::{TicketingInput, TierInput};
use crate::api::body::{Body, Extra, Input, Str};
use crate::api::errors::ApiError;
use crate::api::validation::Limits;

/// The longest note a holder can send the club with a refund request.
pub const REFUND_NOTE_MAX_LENGTH: usize = 500;
/// The most tickets any one request names, before the controlbox's own limit.
const QUANTITY_LIMIT: i64 = 20;
/// The most tiers any one request names, before the controlbox's own limit.
const TIER_LIMIT: usize = 20;
/// The longest tier name.
pub const TIER_NAME_MAX_LENGTH: usize = 60;

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
    let capacity = optional_int(&mut body, "capacity", Limits::default().gt(0).le(limit));
    let paused = body.required_bool("paused");
    let tiers = if body.has_field("tiers") {
        body.list("tiers", 1, TIER_LIMIT, |body, loc, value| {
            body.nested_item(loc, value, Extra::Forbid, tier)
        })
        .value()
    } else {
        body.missing("tiers");
        None
    };
    body.finish().map(|()| TicketingInput {
        capacity: capacity.map(|capacity| capacity as i32),
        paused: paused.unwrap_or_default(),
        tiers: tiers.unwrap_or_default(),
    })
}

/// `TicketTierUpdate`: one tier of the event's tickets.
fn tier(body: &mut Body) -> Option<TierInput> {
    let limit = i64::from(i32::MAX);
    let id = match body.uuid("id") {
        Input::Given(id) => Some(id),
        _ => None,
    };
    let name = body.required_string("name", &Str::new().strip().min(1).max(TIER_NAME_MAX_LENGTH));
    let price_cents = body.required_int("price_cents", Limits::default().ge(0).le(limit));
    let capacity = optional_int(body, "capacity", Limits::default().gt(0).le(limit));
    Some(TierInput {
        id,
        name: name?,
        price_cents: price_cents? as i32,
        capacity: capacity.map(|capacity| capacity as i32),
    })
}

/// `FreeTicketCreate`: the date and tier to take a free ticket to.
pub fn free_ticket(mut body: Body) -> Result<(Uuid, Uuid), ApiError> {
    let date = body.required_uuid("event_date_id");
    let tier = body.required_uuid("tier_id");
    body.finish()
        .map(|()| (date.unwrap_or_default(), tier.unwrap_or_default()))
}

/// `TicketCheckoutCreate`: the date, the tier and how many tickets.
pub fn checkout(mut body: Body) -> Result<(Uuid, Uuid, i32), ApiError> {
    let date = body.required_uuid("event_date_id");
    let tier = body.required_uuid("tier_id");
    let quantity = body.required_int("quantity", Limits::default().ge(1).le(QUANTITY_LIMIT));
    body.finish().map(|()| {
        (
            date.unwrap_or_default(),
            tier.unwrap_or_default(),
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

    fn general(price_cents: i32) -> TierInput {
        TierInput {
            id: None,
            name: "General admission".into(),
            price_cents,
            capacity: None,
        }
    }

    #[test]
    fn ticketing_settings_have_no_limit_unless_given_one() {
        assert_eq!(
            ticketing(body(json!({
                "paused": false,
                "tiers": [{"name": "  General admission ", "price_cents": 0}],
            })))
            .unwrap(),
            TicketingInput {
                capacity: None,
                paused: false,
                tiers: vec![general(0)],
            }
        );
        let id = Uuid::from_u128(9);
        assert_eq!(
            ticketing(body(json!({
                "capacity": 80,
                "paused": true,
                "tiers": [
                    {"id": id.to_string(), "name": "Members", "price_cents": 0, "capacity": 20},
                    {"id": null, "name": "General admission", "price_cents": 1500, "capacity": null},
                ],
            })))
            .unwrap(),
            TicketingInput {
                capacity: Some(80),
                paused: true,
                tiers: vec![
                    TierInput {
                        id: Some(id),
                        name: "Members".into(),
                        price_cents: 0,
                        capacity: Some(20),
                    },
                    general(1500),
                ],
            }
        );
    }

    #[test]
    fn ticketing_settings_refuse_bad_values_together() {
        let error = ticketing(body(json!({
            "capacity": 0,
            "paused": false,
            "tiers": [{"name": " ", "price_cents": -1, "capacity": 0, "extra": 1}],
            "extra": 1,
        })))
        .unwrap_err();
        assert_eq!(
            locs(error),
            [
                r#"["body","capacity"]"#,
                r#"["body","tiers",0,"name"]"#,
                r#"["body","tiers",0,"price_cents"]"#,
                r#"["body","tiers",0,"capacity"]"#,
                r#"["body","tiers",0,"extra"]"#,
                r#"["body","extra"]"#
            ]
        );
        let missing = ticketing(body(json!({}))).unwrap_err();
        assert_eq!(
            locs(missing),
            [r#"["body","paused"]"#, r#"["body","tiers"]"#]
        );
        let none = ticketing(body(json!({"paused": false, "tiers": []}))).unwrap_err();
        assert_eq!(locs(none), [r#"["body","tiers"]"#]);
    }

    #[test]
    fn a_checkout_names_a_date_a_tier_and_a_sensible_quantity() {
        let date = Uuid::from_u128(5);
        let tier = Uuid::from_u128(6);
        let ids = json!({"event_date_id": date.to_string(), "tier_id": tier.to_string()});
        let with = |quantity: i64| {
            let mut value = ids.clone();
            value["quantity"] = json!(quantity);
            body(value)
        };
        assert_eq!(checkout(with(2)).unwrap(), (date, tier, 2));
        assert!(checkout(with(0)).is_err());
        assert!(
            checkout(body(
                json!({"event_date_id": "nope", "tier_id": tier.to_string(), "quantity": 1})
            ))
            .is_err()
        );
        assert_eq!(free_ticket(body(ids.clone())).unwrap(), (date, tier));
        assert!(free_ticket(body(json!({"event_date_id": date.to_string()}))).is_err());
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
