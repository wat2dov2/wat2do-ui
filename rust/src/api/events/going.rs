//! Going selections and the public who's-going list (`going_event_service.py`),
//! and V1 saved events (`v1_saved_event_service.py`).

use base64::Engine;
use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use uuid::Uuid;

use crate::api::errors::ApiError;
use crate::api::messages::{
    EVENT_NOT_FOUND, GOING_EVENTS_CAP_REACHED, INVALID_EVENT_OCCURRENCE, OCCURRENCE_NOT_SELECTABLE,
};
use crate::api::pagination::{DEFAULT_MAX_ROWS, LOAD_PAGE_SIZE, fetch_all_pages};
use crate::controlbox::PUBLIC_ATTENDANCE;
use crate::db::read_with_retry;

/// `GoingEventSelection`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct GoingSelection {
    pub event_id: i64,
    pub occurrence_ids: Vec<Uuid>,
}

/// `get_going_event_selections`: one selection per event, newest Going first,
/// occurrences in the order their rows came.
pub async fn selections(db: &PgPool, user_id: Uuid) -> Result<Vec<GoingSelection>, ApiError> {
    let rows: Vec<(i64, Uuid)> = fetch_all_pages(
        |offset, limit| async move {
            Ok(read_with_retry(|| {
                sqlx::query_as::<_, (i64, Uuid)>(
                    "SELECT event_id::int8, event_date_id FROM public.user_going_events \
                     WHERE user_id = $1 ORDER BY going_at DESC LIMIT $2 OFFSET $3",
                )
                .bind(user_id)
                .bind(limit)
                .bind(offset)
                .fetch_all(db)
            })
            .await?)
        },
        LOAD_PAGE_SIZE,
        DEFAULT_MAX_ROWS,
    )
    .await?;
    Ok(group_selections(rows))
}

fn group_selections(rows: Vec<(i64, Uuid)>) -> Vec<GoingSelection> {
    let mut grouped: indexmap::IndexMap<i64, Vec<Uuid>> = indexmap::IndexMap::new();
    for (event_id, occurrence_id) in rows {
        grouped.entry(event_id).or_default().push(occurrence_id);
    }
    grouped
        .into_iter()
        .map(|(event_id, occurrence_ids)| GoingSelection {
            event_id,
            occurrence_ids,
        })
        .collect()
}

/// The dates of one event the user is going to, in the order they chose them.
pub async fn occurrence_ids(
    db: &PgPool,
    user_id: Uuid,
    event_id: i64,
) -> Result<Vec<Uuid>, ApiError> {
    Ok(read_with_retry(|| {
        sqlx::query_scalar::<_, Uuid>(
            "SELECT event_date_id FROM public.user_going_events \
             WHERE user_id = $1 AND event_id = $2 ORDER BY going_at",
        )
        .bind(user_id)
        .bind(event_id)
        .fetch_all(db)
    })
    .await?)
}

/// `GoingEventStatusResponse`.
#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct GoingStatus {
    pub status: String,
    pub event_id: i64,
    pub occurrence_ids: Vec<Uuid>,
    pub going_count: i64,
}

/// The RPC's refusals, as `_RPC_ERRORS` maps them.
fn rpc_refusal(message: &str) -> Option<ApiError> {
    Some(match message {
        "event_not_found" => ApiError::not_found(EVENT_NOT_FOUND),
        "invalid_event_occurrence" => ApiError::validation(INVALID_EVENT_OCCURRENCE),
        "event_cancelled" | "occurrence_not_selectable" => {
            ApiError::validation(OCCURRENCE_NOT_SELECTABLE)
        }
        "going_events_cap_reached" => ApiError::validation(GOING_EVENTS_CAP_REACHED),
        _ => return None,
    })
}

/// `set_going_occurrences`: replace the user's whole selection for an event.
pub async fn set_occurrences(
    db: &PgPool,
    user_id: Uuid,
    event_id: i64,
    occurrence_ids: &[Uuid],
) -> Result<GoingStatus, ApiError> {
    let result = sqlx::query_as::<_, GoingStatus>(
        "SELECT status, event_id::int8 AS event_id, occurrence_ids, going_count::int8 AS going_count \
         FROM public.set_user_going_occurrences($1, $2, $3)",
    )
    .bind(user_id)
    .bind(event_id as i32)
    .bind(occurrence_ids)
    .fetch_optional(db)
    .await;
    match result {
        Ok(Some(status)) => Ok(status),
        Ok(None) => Err(ApiError::Internal(anyhow::anyhow!(
            "Going mutation returned no result"
        ))),
        Err(sqlx::Error::Database(error)) if error.code().as_deref() == Some("P0001") => {
            match rpc_refusal(error.message()) {
                Some(refusal) => Err(refusal),
                None => Err(sqlx::Error::Database(error).into()),
            }
        }
        Err(error) => Err(error.into()),
    }
}

/// `EventAttendeeResponse`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Attendee {
    pub name: String,
    pub avatar_url: String,
}

/// `EventAttendeesResponse`.
#[derive(Debug, Serialize)]
pub struct Attendees {
    pub going_count: i64,
    pub attendees: Vec<Attendee>,
}

/// `_abbreviate_full_name`: "First Middle Last" becomes "First L.".
pub fn abbreviate(full_name: Option<&str>) -> Option<String> {
    let parts: Vec<&str> = full_name?
        .split(crate::text::python_space)
        .filter(|part| !part.is_empty())
        .collect();
    match parts.as_slice() {
        [] => None,
        [only] => Some((*only).to_owned()),
        [first, .., last] => Some(format!(
            "{first} {}.",
            last.chars().next().unwrap_or_default()
        )),
    }
}

/// `user_service.avatar_url_for_user`: the uploaded photo, else a stable identicon.
pub fn avatar_url(user_id: &str, avatar_url: Option<&str>) -> String {
    if let Some(url) = avatar_url.filter(|url| !url.is_empty()) {
        return url.to_owned();
    }
    let digest = Sha256::digest(user_id.as_bytes());
    let hue = u32::from(u16::from_be_bytes([digest[0], digest[1]])) % 360;
    let mut cells = String::new();
    for y in 0..5 {
        for x in 0..3 {
            if digest[2 + y * 3 + x] & 1 == 1 {
                let mut columns = vec![x, 4 - x];
                columns.dedup();
                for column in columns {
                    cells.push_str(&format!("M{} {}h16v16h-16z", 10 + column * 16, 10 + y * 16));
                }
            }
        }
    }
    let svg = format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 100 100\">\
         <rect width=\"100\" height=\"100\" fill=\"#f1f5f9\"/>\
         <path fill=\"hsl({hue} 55% 42%)\" d=\"{cells}\"/></svg>"
    );
    format!(
        "data:image/svg+xml;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(svg)
    )
}

/// `get_going_counts_for_events([event_id])` and `get_event_attendees`.
pub async fn attendees(db: &PgPool, event_id: i64) -> Result<Attendees, ApiError> {
    let going_count: Option<i64> = read_with_retry(|| {
        sqlx::query_scalar(
            "SELECT going_count::int8 FROM public.get_event_going_counts(ARRAY[$1::int4])",
        )
        .bind(event_id)
        .fetch_optional(db)
    })
    .await?;
    // Distinct users by first Going time, reading pages only until the
    // display cap is reached (Python read every page, then kept the first few).
    // Ticket holders count toward Going but are never named: a ticket should
    // not put anyone's name and face on a public list.
    let cap = PUBLIC_ATTENDANCE.maximum_display_names;
    let mut user_ids: Vec<Uuid> = Vec::new();
    let mut offset = 0;
    while user_ids.len() < cap {
        let page: Vec<Uuid> = read_with_retry(|| {
            sqlx::query_scalar::<_, Uuid>(
                "SELECT g.user_id FROM public.user_going_events g WHERE g.event_id = $1 \
                 AND NOT EXISTS (SELECT 1 FROM public.tickets t WHERE t.event_id = g.event_id \
                                 AND t.holder_user_id = g.user_id AND t.status = 'valid') \
                 ORDER BY g.going_at LIMIT $2 OFFSET $3",
            )
            .bind(event_id)
            .bind(LOAD_PAGE_SIZE)
            .bind(offset)
            .fetch_all(db)
        })
        .await?;
        for id in &page {
            if user_ids.len() < cap && !user_ids.contains(id) {
                user_ids.push(*id);
            }
        }
        if (page.len() as i64) < LOAD_PAGE_SIZE {
            break;
        }
        offset += LOAD_PAGE_SIZE;
    }
    let mut attendees = Vec::with_capacity(user_ids.len());
    if !user_ids.is_empty() {
        let users: Vec<(Uuid, Option<String>, Option<String>)> = read_with_retry(|| {
            sqlx::query_as("SELECT id, full_name, avatar_url FROM public.users WHERE id = ANY($1)")
                .bind(&user_ids)
                .fetch_all(db)
        })
        .await?;
        for id in &user_ids {
            let row = users.iter().find(|(user, ..)| user == id);
            let (full_name, photo) = row.map_or((None, None), |(_, name, photo)| {
                (name.as_deref(), photo.as_deref())
            });
            attendees.push(Attendee {
                name: abbreviate(full_name).unwrap_or_default(),
                avatar_url: avatar_url(&id.to_string(), photo),
            });
        }
    }
    Ok(Attendees {
        going_count: going_count.unwrap_or(0),
        attendees,
    })
}

/// `get_saved_event_ids`: the user's V1 saved events, newest first.
pub async fn saved_event_ids(db: &PgPool, user_id: Uuid) -> Result<Vec<i64>, ApiError> {
    fetch_all_pages(
        |offset, limit| async move {
            Ok(read_with_retry(|| {
                sqlx::query_scalar::<_, i64>(
                    "SELECT event_id::int8 FROM public.v1_saved_events WHERE user_id = $1 \
                     ORDER BY saved_at DESC LIMIT $2 OFFSET $3",
                )
                .bind(user_id)
                .bind(limit)
                .bind(offset)
                .fetch_all(db)
            })
            .await?)
        },
        LOAD_PAGE_SIZE,
        DEFAULT_MAX_ROWS,
    )
    .await
}

/// `save_event`: idempotent.
pub async fn save_event(db: &PgPool, user_id: Uuid, event_id: i64) -> Result<(), ApiError> {
    let existing: Option<Uuid> = read_with_retry(|| {
        sqlx::query_scalar(
            "SELECT id FROM public.v1_saved_events WHERE user_id = $1 AND event_id = $2 LIMIT 1",
        )
        .bind(user_id)
        .bind(event_id)
        .fetch_optional(db)
    })
    .await?;
    if existing.is_none() {
        let inserted = sqlx::query(
            "INSERT INTO public.v1_saved_events (id, user_id, event_id) VALUES ($1, $2, $3)",
        )
        .bind(Uuid::new_v4())
        .bind(user_id)
        .bind(event_id as i32)
        .execute(db)
        .await?;
        if inserted.rows_affected() == 0 {
            tracing::warn!(
                "Insert returned no data for save_event(user_id={user_id}, event_id={event_id}), using payload fallback"
            );
        }
    }
    Ok(())
}

/// `unsave_event`.
pub async fn unsave_event(db: &PgPool, user_id: Uuid, event_id: i64) -> Result<(), ApiError> {
    sqlx::query("DELETE FROM public.v1_saved_events WHERE user_id = $1 AND event_id = $2")
        .bind(user_id)
        .bind(event_id)
        .execute(db)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selections_group_by_event_in_first_seen_order() {
        // test_get_going_event_selections_groups_occurrences
        let (a, b, c) = (Uuid::from_u128(1), Uuid::from_u128(2), Uuid::from_u128(3));
        assert_eq!(
            group_selections(vec![(5, a), (7, b), (5, c)]),
            vec![
                GoingSelection {
                    event_id: 5,
                    occurrence_ids: vec![a, c]
                },
                GoingSelection {
                    event_id: 7,
                    occurrence_ids: vec![b]
                },
            ]
        );
    }

    #[test]
    fn rpc_refusals_map_to_api_errors() {
        // test_set_going_occurrences_reports_time_unavailable
        assert!(
            matches!(rpc_refusal("event_not_found"), Some(ApiError::NotFound(d)) if d == EVENT_NOT_FOUND)
        );
        for message in ["event_cancelled", "occurrence_not_selectable"] {
            assert!(
                matches!(rpc_refusal(message), Some(ApiError::Validation { detail, .. }) if detail == OCCURRENCE_NOT_SELECTABLE)
            );
        }
        assert!(
            matches!(rpc_refusal("going_events_cap_reached"), Some(ApiError::Validation { detail, .. }) if detail == GOING_EVENTS_CAP_REACHED)
        );
        assert!(rpc_refusal("user_not_found").is_none());
    }

    #[test]
    fn names_are_abbreviated_for_public_display() {
        assert_eq!(
            abbreviate(Some("Sean Michael Young")).as_deref(),
            Some("Sean Y.")
        );
        assert_eq!(abbreviate(Some("Cher")).as_deref(), Some("Cher"));
        assert_eq!(abbreviate(Some("  ")), None);
        assert_eq!(abbreviate(None), None);
        assert_eq!(
            abbreviate(Some("Émile  Ørsted")).as_deref(),
            Some("Émile Ø.")
        );
    }

    #[test]
    fn identicons_match_python() {
        // user_service.avatar_url_for_user("00000000-0000-0000-0000-000000000001")
        let expected = include_str!("testdata/identicon.txt").trim();
        assert_eq!(
            avatar_url("00000000-0000-0000-0000-000000000001", None),
            expected
        );
        assert_eq!(avatar_url("x", Some("https://a/b.png")), "https://a/b.png");
    }
}
