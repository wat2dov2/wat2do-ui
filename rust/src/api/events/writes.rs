//! Event writes (`event_service.create_event`, `update_event`, `delete_event`)
//! and who may make them (`routers/events.py` with `club_service.publish_refusal`).
//!
//! An update (the occurrences RPC) and a delete each run in one transaction
//! with the event's tickets locked, so neither strands a ticket someone holds
//! (`tickets::ticketing::guard_edit`, `guard_delete`); a create inserts the
//! event and its occurrences in one transaction.

use serde_json::{Value, json};
use sqlx::PgPool;

use super::model::Event;
use super::requests::{EventInput, OccurrenceInput};
use super::store;
use crate::api::auth::User;
use crate::api::errors::ApiError;
use crate::api::messages::{
    CLUB_EVENT_CREATION_REQUIRED, CLUB_NOT_FOUND, CLUB_PENDING_REVIEW, EVENT_ALREADY_PAST,
    EVENT_NOT_FOUND, NOT_AUTHORIZED,
};
use crate::api::validation::PyInt;
use crate::controlbox::EVENT_DISCOVERY;
use crate::db::read_with_retry;
use crate::text::python_strip;

/// Postgres' answer when a Python int does not fit an `integer` column:
/// PostgREST's 22003, which FastAPI reported as a 502.
pub fn int4(value: PyInt) -> Result<i64, ApiError> {
    match value {
        PyInt::Small(id) if i32::try_from(id).is_ok() => Ok(id),
        _ => {
            tracing::error!(
                "Unhandled database error on request [code=22003]: value is out of range for type integer"
            );
            Err(ApiError::http(
                axum::http::StatusCode::BAD_GATEWAY,
                crate::api::messages::DB_OPERATION_FAILED,
            ))
        }
    }
}

/// The club fields publishing decisions and derived event fields read.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Club {
    pub id: i64,
    pub club_name: String,
    pub status: String,
    pub school_id: Option<i64>,
    /// The school's slug.
    pub school: Option<String>,
    /// Whether the acting user is on the club's management team.
    pub is_member: bool,
}

/// The club, with whether `user` is on its management team.
pub async fn club(db: &PgPool, club_id: i64, user: &User) -> Result<Option<Club>, ApiError> {
    Ok(read_with_retry(|| {
        sqlx::query_as::<_, Club>(
            "SELECT c.id::int8 AS id, c.club_name, c.status, c.school_id::int8 AS school_id, \
             NULLIF(s.slug, '') AS school, EXISTS (SELECT 1 FROM public.club_members m \
             WHERE m.club_id = c.id AND m.user_id = $2) AS is_member \
             FROM public.clubs c LEFT JOIN public.schools s ON s.id = c.school_id WHERE c.id = $1",
        )
        .bind(club_id)
        .bind(user.id)
        .fetch_optional(db)
    })
    .await?)
}

/// `club_service.publish_refusal`: why `user` may not publish under `club`.
pub fn publish_refusal(club: &Club, user: &User) -> Option<&'static str> {
    if user.is_admin() {
        return None;
    }
    if club.status != "approved" {
        return Some(CLUB_PENDING_REVIEW);
    }
    if !club.is_member {
        return Some(CLUB_EVENT_CREATION_REQUIRED);
    }
    None
}

/// `_authorize_event_club`: the club exists and `user` may publish under it.
pub async fn authorize_club(db: &PgPool, club_id: PyInt, user: &User) -> Result<Club, ApiError> {
    let found = club(db, int4(club_id)?, user)
        .await?
        .ok_or_else(|| ApiError::not_found(CLUB_NOT_FOUND))?;
    match publish_refusal(&found, user) {
        Some(refusal) => Err(ApiError::authorization(refusal)),
        None => Ok(found),
    }
}

/// `_get_event_or_404_authorized`: its creator, an admin, or its club's team.
/// An event with tickets answers only to its club's current team (or an
/// admin): its creator may since have left the club.
pub async fn authorized_event(
    db: &PgPool,
    event_id: PyInt,
    user: &User,
) -> Result<Event, ApiError> {
    let event = store::event_by_id(db, int4(event_id)?)
        .await?
        .ok_or_else(|| ApiError::not_found(EVENT_NOT_FOUND))?;
    if user.is_admin() {
        return Ok(event);
    }
    let is_creator = event.created_by.is_some_and(|creator| creator == user.id);
    if is_creator
        && crate::api::tickets::store::ticketing(db, event.id)
            .await?
            .is_none()
    {
        return Ok(event);
    }
    let Some(club_id) = event.club_id else {
        return Err(ApiError::authorization(NOT_AUTHORIZED));
    };
    authorize_club(db, PyInt::Small(club_id), user).await?;
    Ok(event)
}

/// `_resolve_club_fields`: the event's display name and school come from its club.
fn club_fields(club: &Club) -> Result<(Value, i64, Option<String>), ApiError> {
    let school_id = club
        .school_id
        .ok_or_else(|| ApiError::validation("Club school is not registered"))?;
    Ok((json!(club.club_name), school_id, club.school.clone()))
}

/// `normalize_campus_season_ids(value, school, strict=True)`.
pub fn campus_season_ids(value: &Value, school: Option<&str>) -> Result<Value, ApiError> {
    let Value::Array(items) = value else {
        return Ok(Value::Null);
    };
    let slug = python_strip(school.unwrap_or_default()).to_lowercase();
    let allowed: Vec<&str> = EVENT_DISCOVERY
        .campus_seasons
        .schools
        .get(&slug)
        .map(|configured| {
            configured
                .seasons
                .iter()
                .map(|season| season.id.as_str())
                .collect()
        })
        .unwrap_or_default();
    let mut valid: Vec<String> = items
        .iter()
        .filter_map(Value::as_str)
        .filter(|id| allowed.contains(id))
        .map(str::to_owned)
        .collect();
    valid.sort();
    valid.dedup();
    if items
        .iter()
        .any(|item| item.as_str().is_none_or(|id| !allowed.contains(&id)))
    {
        return Err(ApiError::validation(
            "Campus season IDs must be configured for the event's school",
        ));
    }
    Ok(if valid.is_empty() && !items.is_empty() {
        Value::Null
    } else {
        json!(valid)
    })
}

fn occurrence_rows(occurrences: &[OccurrenceInput], event_id: i64) -> Value {
    Value::Array(
        occurrences
            .iter()
            .map(|occurrence| {
                let mut row = occurrence.dump(false);
                row["event_id"] = json!(event_id);
                row
            })
            .collect(),
    )
}

/// `create_event`: insert the event with fields derived from its club and
/// its occurrences in one transaction, then read it back.
pub async fn create(
    db: &PgPool,
    input: EventInput,
    club: &Club,
    created_by: &str,
) -> Result<Event, ApiError> {
    // One transaction: dropping the request (a client disconnect, the drain
    // deadline) or failing the occurrence insert rolls the event back too, so
    // an event never exists without its occurrences. Python deleted the
    // orphan by hand; the error returned is the same.
    let mut transaction = db.begin().await?;
    let new_id = insert(&mut transaction, input, club, created_by).await?;
    transaction.commit().await?;
    created(db, new_id).await
}

/// A new event's occurrences, from `occurrence_rows`.
pub const OCCURRENCES_INSERT: &str = "INSERT INTO public.event_dates (dtstart_utc, dtend_utc, duration, tz, event_id) \
     SELECT dtstart_utc, dtend_utc, duration, tz, event_id \
     FROM jsonb_populate_recordset(NULL::public.event_dates, $1)";

/// The writes of `create`, inside the caller's transaction: the event row
/// (its club name and school from `club`) and its occurrences. Returns its id.
pub async fn insert(
    transaction: &mut sqlx::PgConnection,
    input: EventInput,
    club: &Club,
    created_by: &str,
) -> Result<i64, ApiError> {
    let (club_name, school_id, school) = club_fields(club)?;
    let mut payload = input.fields;
    payload.insert("club".into(), club_name);
    payload.insert("school_id".into(), json!(school_id));
    let seasons = payload
        .get("campus_season_ids")
        .cloned()
        .unwrap_or(Value::Null);
    payload.insert(
        "campus_season_ids".into(),
        campus_season_ids(&seasons, school.as_deref())?,
    );
    payload.insert("created_by".into(), json!(created_by));
    let columns: Vec<String> = payload.keys().map(|key| format!("\"{key}\"")).collect();
    let columns = columns.join(", ");
    let new_id: i64 = sqlx::query_scalar(&format!(
        "INSERT INTO public.events ({columns}) SELECT {columns} \
         FROM jsonb_populate_record(NULL::public.events, $1) RETURNING id::int8"
    ))
    .bind(Value::Object(payload))
    .fetch_one(&mut *transaction)
    .await?;
    let occurrences = input.occurrences.unwrap_or_default();
    if !occurrences.is_empty() {
        sqlx::query(OCCURRENCES_INSERT)
            .bind(occurrence_rows(&occurrences, new_id))
            .execute(&mut *transaction)
            .await?;
    }
    Ok(new_id)
}

/// After a created event commits: read it back and refresh its school's feed.
pub async fn created(db: &PgPool, new_id: i64) -> Result<Event, ApiError> {
    let created = store::event_by_id(db, new_id)
        .await?
        .ok_or_else(|| ApiError::Internal(anyhow::anyhow!("Failed to read created event")))?;
    crate::revalidation::revalidate_schools(
        &created.school.iter().cloned().collect::<Vec<_>>(),
        &["events", "clubs"],
    )
    .await;
    Ok(created)
}

/// `update_event`: refuse past events, re-derive club fields when the club
/// changes, then apply the patch and occurrences in one transaction (the RPC).
pub async fn update(
    db: &PgPool,
    event_id: i64,
    input: EventInput,
    new_club: Option<&Club>,
) -> Result<Option<Event>, ApiError> {
    let Some(existing) = store::event_by_id(db, event_id).await? else {
        return Ok(None);
    };
    if existing.has_ended(chrono::Utc::now()) {
        tracing::warn!("Rejected update to past event id={event_id} (last occurrence ended)");
        return Err(ApiError::validation(EVENT_ALREADY_PAST));
    }
    let mut payload = input.fields;
    payload.shift_remove("occurrences");
    let mut school = existing.school.clone();
    if let Some(club) = new_club {
        let (club_name, school_id, resolved) = club_fields(club)?;
        payload.insert("club".into(), club_name);
        payload.insert("school_id".into(), json!(school_id));
        school = resolved;
        if school != existing.school {
            payload.insert("cohost_club_ids".into(), json!([]));
            if !payload.contains_key("campus_season_ids") {
                payload.insert("campus_season_ids".into(), Value::Null);
            }
        }
    }
    if let Some(seasons) = payload.get("campus_season_ids").cloned() {
        payload.insert(
            "campus_season_ids".into(),
            campus_season_ids(&seasons, school.as_deref())?,
        );
    }
    // An edit keeps the dates it names by id; the rest are removed.
    let kept_dates: Option<Vec<uuid::Uuid>> = input.occurrences.as_ref().map(|occurrences| {
        occurrences
            .iter()
            .filter_map(|occurrence| occurrence.id)
            .collect()
    });
    let occurrences = input.occurrences.map(|occurrences| {
        Value::Array(
            occurrences
                .iter()
                .map(|occurrence| occurrence.dump(true))
                .collect(),
        )
    });
    let mut transaction = db.begin().await?;
    crate::api::tickets::ticketing::guard_edit(
        &mut transaction,
        &existing,
        new_club.map(|club| club.id),
        kept_dates.as_deref(),
        chrono::Utc::now(),
    )
    .await?;
    sqlx::query("SELECT public.update_event_with_occurrences($1, $2, $3)")
        .bind(event_id as i32)
        .bind(Value::Object(payload))
        .bind(occurrences)
        .execute(&mut *transaction)
        .await?;
    transaction.commit().await?;
    let updated = store::event_by_id(db, event_id).await?;
    if let Some(updated) = &updated {
        let schools: Vec<String> = [existing.school.clone(), updated.school.clone()]
            .into_iter()
            .flatten()
            .collect();
        crate::revalidation::revalidate_schools(&schools, &["events", "clubs"]).await;
    }
    Ok(updated)
}

/// `delete_event`: delete it, then refresh its school's feed if a row went.
pub async fn delete(db: &PgPool, existing: &Event) -> Result<(), ApiError> {
    let mut transaction = db.begin().await?;
    crate::api::tickets::ticketing::guard_delete(&mut transaction, existing.id, chrono::Utc::now())
        .await?;
    let deleted = sqlx::query("DELETE FROM public.events WHERE id = $1")
        .bind(existing.id)
        .execute(&mut *transaction)
        .await?
        .rows_affected();
    transaction.commit().await?;
    if deleted > 0 {
        crate::revalidation::revalidate_schools(
            &existing.school.iter().cloned().collect::<Vec<_>>(),
            &["events", "clubs"],
        )
        .await;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn user(role: &str) -> User {
        User {
            id: Uuid::from_u128(1),
            email: "a@b.c".into(),
            role: role.into(),
            school_id: None,
            school: None,
        }
    }

    fn club_with(status: &str, is_member: bool) -> Club {
        Club {
            id: 7,
            club_name: "UW Tea Club".into(),
            status: status.into(),
            school_id: Some(1),
            school: Some("uwaterloo".into()),
            is_member,
        }
    }

    #[test]
    fn publishing_needs_an_approved_club_and_membership_unless_admin() {
        // test_create_event_* in tests/routers/test_events.py
        assert_eq!(
            publish_refusal(&club_with("approved", true), &user("user")),
            None
        );
        assert_eq!(
            publish_refusal(&club_with("approved", false), &user("user")),
            Some(CLUB_EVENT_CREATION_REQUIRED)
        );
        assert_eq!(
            publish_refusal(&club_with("pending", true), &user("user")),
            Some(CLUB_PENDING_REVIEW)
        );
        assert_eq!(
            publish_refusal(&club_with("pending", false), &user("admin")),
            None
        );
    }

    #[test]
    fn club_fields_come_from_the_club() {
        // test_resolve_club_fields_derives_from_club
        let (name, school_id, school) = club_fields(&club_with("approved", true)).unwrap();
        assert_eq!(
            (name, school_id, school.as_deref()),
            (json!("UW Tea Club"), 1, Some("uwaterloo"))
        );
        let mut orphan = club_with("approved", true);
        orphan.school_id = None;
        assert!(
            matches!(club_fields(&orphan), Err(ApiError::Validation { detail, .. }) if detail == "Club school is not registered")
        );
    }

    #[test]
    fn campus_seasons_must_belong_to_the_school() {
        // test_create_rejects_seasons_outside_resolved_club_school and friends
        let configured = EVENT_DISCOVERY
            .campus_seasons
            .schools
            .iter()
            .find(|(_, school)| !school.seasons.is_empty())
            .map(|(slug, school)| (slug.clone(), school.seasons[0].id.clone()))
            .unwrap();
        let (slug, season) = configured;
        assert_eq!(
            campus_season_ids(&Value::Null, Some(&slug)).unwrap(),
            Value::Null
        );
        assert_eq!(
            campus_season_ids(&json!([]), Some(&slug)).unwrap(),
            json!([])
        );
        assert_eq!(
            campus_season_ids(&json!([season, season]), Some(&slug)).unwrap(),
            json!([season])
        );
        assert!(campus_season_ids(&json!(["nope"]), Some(&slug)).is_err());
        assert!(campus_season_ids(&json!([season]), Some("no-such-school")).is_err());
    }

    #[test]
    fn out_of_range_ids_fail_like_postgres() {
        assert_eq!(int4(PyInt::Small(7)).unwrap(), 7);
        assert!(int4(PyInt::Small(3_000_000_000)).is_err());
        assert!(int4(PyInt::Huge).is_err());
    }
}
