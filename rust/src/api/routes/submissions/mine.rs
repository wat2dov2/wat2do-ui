//! `/users/me/submissions`: everything the signed-in user sent in for review
//! (events, positions and clubs), newest first, each with where it stands
//! and, once approved, what it became.

use axum::Json;
use axum::extract::State;
use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::Row;
use sqlx::postgres::PgRow;
use utoipa::ToSchema;

use crate::api::AppState;
use crate::api::auth::DbUser;
use crate::api::errors::ApiError;
use crate::api::json;
use crate::db::read_with_retry;

/// Where a submission stands in review.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum SubmissionStatus {
    Pending,
    Approved,
    Rejected,
}

impl SubmissionStatus {
    fn from_db(status: &str) -> Self {
        match status {
            "approved" => Self::Approved,
            "rejected" => Self::Rejected,
            _ => Self::Pending,
        }
    }
}

/// An event the user submitted.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct SubmittedEvent {
    pub id: String,
    pub title: String,
    pub status: SubmissionStatus,
    #[serde(serialize_with = "json::datetime")]
    #[schema(value_type = String, format = DateTime)]
    pub submitted_at: DateTime<Utc>,
    /// The school slug whose site lists it.
    #[schema(required = true)]
    pub school: Option<String>,
    #[schema(required = true)]
    pub source_image_url: Option<String>,
    #[schema(required = true)]
    pub club_logo_url: Option<String>,
    /// The event its approval published, while that event exists.
    #[schema(required = true)]
    pub event_id: Option<i32>,
}

/// A position the user submitted.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct SubmittedPosition {
    pub id: String,
    pub title: String,
    pub status: SubmissionStatus,
    #[serde(serialize_with = "json::datetime")]
    #[schema(value_type = String, format = DateTime)]
    pub submitted_at: DateTime<Utc>,
    #[schema(required = true)]
    pub school: Option<String>,
    #[schema(required = true)]
    pub source_image_url: Option<String>,
    #[schema(required = true)]
    pub club_logo_url: Option<String>,
    /// The club it is for, whose page lists it once approved.
    #[schema(required = true)]
    pub club_id: Option<i32>,
}

/// A club the user submitted.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct SubmittedClub {
    pub id: i32,
    pub club_name: String,
    pub status: SubmissionStatus,
    #[serde(serialize_with = "json::option_datetime")]
    #[schema(value_type = Option<String>, format = DateTime, required = true)]
    pub submitted_at: Option<DateTime<Utc>>,
    #[schema(required = true)]
    pub school: Option<String>,
    #[schema(required = true)]
    pub logo_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct MySubmissionsResponse {
    pub events: Vec<SubmittedEvent>,
    pub positions: Vec<SubmittedPosition>,
    pub clubs: Vec<SubmittedClub>,
}

/// The club a submission's JSON names, when its `club_id` is a plain id.
fn named_club(data: &str) -> String {
    format!("CASE WHEN {data}->>'club_id' ~ '^[0-9]{{1,9}}$' THEN ({data}->>'club_id')::int END")
}

fn events_sql() -> String {
    format!(
        "SELECT es.id::text AS id, es.event_data->>'title' AS title, es.status::text AS status, \
             es.submitted_at, NULLIF(s.slug, '') AS school, \
             es.event_data->>'source_image_url' AS source_image_url, \
             c.logo_url AS club_logo_url, es.event_id \
         FROM public.event_submissions es \
         LEFT JOIN public.schools s ON s.id = es.school_id \
         LEFT JOIN public.clubs c ON c.id = {} \
         WHERE es.user_id = $1 ORDER BY es.submitted_at DESC",
        named_club("es.event_data")
    )
}

fn positions_sql() -> String {
    format!(
        "SELECT ps.id::text AS id, ps.position_data->>'title' AS title, ps.status AS status, \
             ps.submitted_at, NULLIF(s.slug, '') AS school, \
             ps.position_data->>'source_image_url' AS source_image_url, \
             c.logo_url AS club_logo_url, c.id AS club_id \
         FROM public.position_submissions ps \
         LEFT JOIN public.schools s ON s.id = ps.school_id \
         LEFT JOIN public.clubs c ON c.id = {} \
         WHERE ps.user_id = $1 ORDER BY ps.submitted_at DESC",
        named_club("ps.position_data")
    )
}

/// Clubs sent through the Add club form (`submitted`), not the ones found
/// by ingestion or created by admins.
const CLUBS_SQL: &str = "SELECT c.id, c.club_name, c.status::text AS status, \
         c.created_at AS submitted_at, NULLIF(s.slug, '') AS school, c.logo_url \
     FROM public.clubs c LEFT JOIN public.schools s ON s.id = c.school_id \
     WHERE c.created_by = $1 AND c.submitted \
     ORDER BY c.created_at DESC NULLS LAST, c.id DESC";

fn event(row: &PgRow) -> Result<SubmittedEvent, sqlx::Error> {
    Ok(SubmittedEvent {
        id: row.try_get("id")?,
        title: row
            .try_get::<Option<String>, _>("title")?
            .unwrap_or_default(),
        status: SubmissionStatus::from_db(row.try_get("status")?),
        submitted_at: row.try_get("submitted_at")?,
        school: row.try_get("school")?,
        source_image_url: row.try_get("source_image_url")?,
        club_logo_url: row.try_get("club_logo_url")?,
        event_id: row.try_get("event_id")?,
    })
}

fn position(row: &PgRow) -> Result<SubmittedPosition, sqlx::Error> {
    Ok(SubmittedPosition {
        id: row.try_get("id")?,
        title: row
            .try_get::<Option<String>, _>("title")?
            .unwrap_or_default(),
        status: SubmissionStatus::from_db(row.try_get("status")?),
        submitted_at: row.try_get("submitted_at")?,
        school: row.try_get("school")?,
        source_image_url: row.try_get("source_image_url")?,
        club_logo_url: row.try_get("club_logo_url")?,
        club_id: row.try_get("club_id")?,
    })
}

fn club(row: &PgRow) -> Result<SubmittedClub, sqlx::Error> {
    Ok(SubmittedClub {
        id: row.try_get("id")?,
        club_name: row.try_get("club_name")?,
        status: SubmissionStatus::from_db(row.try_get("status")?),
        submitted_at: row.try_get("submitted_at")?,
        school: row.try_get("school")?,
        logo_url: row.try_get("logo_url")?,
    })
}

#[utoipa::path(
    get,
    path = "/users/me/submissions",
    tag = "users",
    operation_id = "list_my_submissions_users_me_submissions_get",
    summary = "List My Submissions",
    description = "The events, positions and clubs the user submitted for review, newest first.",
    responses((status = 200, description = "Successful Response", body = MySubmissionsResponse))
)]
pub async fn list_my_submissions(
    State(state): State<AppState>,
    DbUser(user): DbUser,
) -> Result<Json<MySubmissionsResponse>, ApiError> {
    let (events_sql, positions_sql) = (events_sql(), positions_sql());
    let events =
        read_with_retry(|| sqlx::query(&events_sql).bind(user.id).fetch_all(&state.db)).await?;
    let positions = read_with_retry(|| {
        sqlx::query(&positions_sql)
            .bind(user.id)
            .fetch_all(&state.db)
    })
    .await?;
    let clubs =
        read_with_retry(|| sqlx::query(CLUBS_SQL).bind(user.id).fetch_all(&state.db)).await?;
    Ok(Json(MySubmissionsResponse {
        events: events.iter().map(event).collect::<Result<_, _>>()?,
        positions: positions.iter().map(position).collect::<Result<_, _>>()?,
        clubs: clubs.iter().map(club).collect::<Result<_, _>>()?,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn statuses_read_from_the_database() {
        assert_eq!(
            SubmissionStatus::from_db("approved"),
            SubmissionStatus::Approved
        );
        assert_eq!(
            SubmissionStatus::from_db("rejected"),
            SubmissionStatus::Rejected
        );
        assert_eq!(
            SubmissionStatus::from_db("pending"),
            SubmissionStatus::Pending
        );
    }

    #[test]
    fn a_club_id_is_read_only_when_it_is_a_plain_id() {
        assert_eq!(
            named_club("es.event_data"),
            "CASE WHEN es.event_data->>'club_id' ~ '^[0-9]{1,9}$' \
             THEN (es.event_data->>'club_id')::int END"
        );
    }
}
