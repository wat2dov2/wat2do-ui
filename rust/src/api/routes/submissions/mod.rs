//! `/submissions`: events sent for admin review, their review and the admin
//! list (`routers/submissions.py`, `services/submission_service.py`), and
//! what `/position-submissions` (`positions`) shares with them.
//!
//! Approving an event submission publishes the event: the event, its
//! occurrences and the submission's new status are written in one
//! transaction (the submission row locked first, so two reviewers cannot
//! publish it twice), and the frontend refresh and the submitter's email
//! follow the commit.

pub mod positions;

use std::sync::LazyLock;

use axum::Json;
use axum::extract::{FromRequestParts, Request, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::{Map, Value};
use sqlx::Row;
use sqlx::postgres::PgRow;
use uuid::Uuid;

use crate::api::AppState;
use crate::api::auth::{AdminUser, AuthUser, OptionalUser, User, find_user};
use crate::api::body::{Body, Extra, Input, json_first};
use crate::api::client_ip::ClientIp;
use crate::api::errors::{ApiError, get_or_404};
use crate::api::events::requests::{self, EventInput};
use crate::api::events::writes;
use crate::api::json;
use crate::api::messages::{
    CLUB_NOT_FOUND, INVALID_STATUS_TRANSITION, SUBMISSION_NOT_FOUND, SUBMISSION_SCHOOL_REQUIRED,
    USER_NOT_FOUND,
};
use crate::api::pagination::{Paginated, Pagination};
use crate::api::rate_limit::RateLimiter;
use crate::api::routes::clubs::emails::{self, Reviewed};
use crate::api::routes::clubs::{AdminFilters, admin_page_sql, parse_review};
use crate::api::routes::events::no_content;
use crate::api::validation::{Length, PathParams, PyInt, QueryParams, Validator};
use crate::constants::{
    MAX_EVENT_DATA_BYTES, MAX_SCHOOL_LENGTH, MAX_SEARCH_QUERY_LENGTH, MAX_STATUS_FILTER_LENGTH,
};
use crate::controlbox::RATE_LIMITS;
use crate::db::read_with_retry;

/// The submission limiter of `POST /submissions/`, by client IP.
static SUBMISSIONS: LazyLock<RateLimiter> =
    LazyLock::new(|| RateLimiter::new(RATE_LIMITS.submissions));

/// `SubmissionStatus`.
pub const STATUSES: &[&str] = &["pending", "approved", "rejected"];

/// `_ALLOWED_TRANSITIONS`: only a pending submission is decided, once.
pub fn allowed(status: &str) -> &'static [&'static str] {
    match status {
        "pending" => &["approved", "rejected"],
        _ => &[],
    }
}

/// `SubmissionMetadata`, in its field order.
#[derive(Debug, Clone, Serialize)]
pub struct Metadata {
    pub school: Option<String>,
    pub id: String,
    pub user_id: Option<String>,
    pub status: String,
    pub rejection_reason: Option<String>,
    #[serde(serialize_with = "json::datetime")]
    pub submitted_at: DateTime<Utc>,
    #[serde(serialize_with = "json::option_datetime")]
    pub reviewed_at: Option<DateTime<Utc>>,
    pub submitted_by_email: Option<String>,
}

/// The columns `Metadata::from_row` reads from a submission row `alias`,
/// with `school` (the slug, or NULL where Python read the bare row).
pub fn metadata_columns(alias: &str, school: &str) -> String {
    format!(
        "{school} AS school, {alias}.id::text AS id, {alias}.user_id::text AS user_id, \
         {alias}.status::text AS status, {alias}.rejection_reason, {alias}.submitted_at, \
         {alias}.reviewed_at, {alias}.submitted_by_email"
    )
}

impl Metadata {
    pub fn from_row(row: &PgRow) -> Result<Self, sqlx::Error> {
        Ok(Self {
            school: row.try_get("school")?,
            id: row.try_get("id")?,
            user_id: row.try_get("user_id")?,
            status: row.try_get("status")?,
            rejection_reason: row.try_get("rejection_reason")?,
            submitted_at: row.try_get("submitted_at")?,
            reviewed_at: row.try_get("reviewed_at")?,
            submitted_by_email: row.try_get("submitted_by_email")?,
        })
    }
}

/// `SubmissionResponse`.
#[derive(Debug, Serialize)]
pub struct SubmissionResponse {
    #[serde(flatten)]
    metadata: Metadata,
    #[serde(serialize_with = "json::value")]
    event_data: Value,
    club_name: Option<String>,
}

impl SubmissionResponse {
    fn from_row(row: &PgRow) -> Result<Self, ApiError> {
        Ok(Self {
            metadata: Metadata::from_row(row)?,
            event_data: row.try_get("event_data")?,
            club_name: row.try_get("club_name")?,
        })
    }
}

/// The event submission columns `SubmissionResponse::from_row` reads from
/// `es`: with the school's slug and the club's name (`_submission_responses`),
/// or, for a row a write returned, without them.
fn event_columns(joined: bool) -> String {
    if joined {
        format!(
            "{}, es.event_data, (SELECT c.club_name FROM public.clubs c WHERE c.id = \
             CASE WHEN es.event_data->>'club_id' ~ '^[0-9]{{1,9}}$' \
             THEN (es.event_data->>'club_id')::int END) AS club_name",
            metadata_columns("es", "NULLIF(s.slug, '')")
        )
    } else {
        format!(
            "{}, es.event_data, NULL::text AS club_name",
            metadata_columns("es", "NULL::text")
        )
    }
}

/// A new pending event submission, returned as written.
fn insert_sql() -> String {
    format!(
        "INSERT INTO public.event_submissions AS es \
             (id, user_id, submitted_by_email, event_data, school_id, status) \
         VALUES ($1, $2, $3, $4, $5, 'pending') RETURNING {}",
        event_columns(false)
    )
}

/// The submission's status, its row locked until the review commits.
const LOCK_SQL: &str =
    "SELECT status::text FROM public.event_submissions WHERE id = $1::uuid FOR UPDATE";

/// The decision (a reason only replaces the stored one when given).
fn update_sql() -> String {
    format!(
        "UPDATE public.event_submissions es SET status = $2, reviewed_at = $3, \
             rejection_reason = COALESCE($4, es.rejection_reason) \
         WHERE es.id = $1::uuid RETURNING {}",
        event_columns(false)
    )
}

const DELETE_SQL: &str = "DELETE FROM public.event_submissions WHERE id = $1::uuid";

/// `get_submission_by_id`. An id that is not a UUID fails in Postgres (a
/// 502), as the data API's filter did.
async fn get_submission(
    db: &sqlx::PgPool,
    id: &str,
) -> Result<Option<SubmissionResponse>, ApiError> {
    let sql = format!(
        "SELECT {} FROM public.event_submissions es \
         LEFT JOIN public.schools s ON s.id = es.school_id WHERE es.id = $1::uuid",
        event_columns(true)
    );
    let row = read_with_retry(|| sqlx::query(&sql).bind(id).fetch_optional(db)).await?;
    row.as_ref().map(SubmissionResponse::from_row).transpose()
}

/// `resolve_db_user` for an optional sender: a signed-in sender without a
/// `users` row is a 404.
pub async fn read_optional_user(
    db: &sqlx::PgPool,
    auth_user: Option<AuthUser>,
) -> Result<Option<User>, ApiError> {
    match auth_user {
        None => Ok(None),
        Some(auth_user) => find_user(db, &auth_user.id)
            .await?
            .map(Some)
            .ok_or_else(|| ApiError::not_found(USER_NOT_FOUND)),
    }
}

/// A required `EmailStr` field.
pub fn required_email(body: &mut Body, name: &'static str) -> Option<String> {
    match body.email(name) {
        Input::Given(email) => Some(email),
        Input::Null => {
            body.type_error(name, "string_type", "Input should be a valid string");
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

/// `SubmissionUpdate`, after the path's problems.
pub fn review_body(
    bytes: &[u8],
    headers: &HeaderMap,
    check: Validator,
) -> Result<(String, Option<String>), ApiError> {
    parse_review(Body::parse(bytes, headers, Extra::Forbid), check)
}

/// The school of the club a submission names (`club.school_id`), if the club exists.
pub async fn club_school(db: &sqlx::PgPool, club_id: i64) -> Result<Option<i32>, ApiError> {
    Ok(read_with_retry(|| {
        sqlx::query_scalar::<_, i32>("SELECT school_id FROM public.clubs WHERE id = $1")
            .bind(club_id)
            .fetch_optional(db)
    })
    .await?)
}

/// `EventCreate.model_dump(mode="json")`: every field in the model's order.
fn event_dump(input: &EventInput) -> Map<String, Value> {
    let mut dump = Map::new();
    for (name, value) in &input.fields {
        dump.insert(name.clone(), value.clone());
        if name == "map_location" {
            let occurrences = input
                .occurrences
                .iter()
                .flatten()
                .map(|occurrence| occurrence.dump(false))
                .collect();
            dump.insert("occurrences".into(), Value::Array(occurrences));
        }
    }
    dump
}

/// The same dump without `None` values, at every level (`exclude_none=True`),
/// as a submission stores it.
fn without_nulls(value: Value) -> Value {
    match value {
        Value::Object(map) => Value::Object(
            map.into_iter()
                .filter(|(_, value)| !value.is_null())
                .map(|(key, value)| (key, without_nulls(value)))
                .collect(),
        ),
        Value::Array(items) => Value::Array(items.into_iter().map(without_nulls).collect()),
        other => other,
    }
}

/// `len(event_data.model_dump_json())`: characters of pydantic's compact JSON.
fn model_json_size(dump: &Map<String, Value>) -> usize {
    #[derive(Serialize)]
    struct Pydantic<'a>(#[serde(serialize_with = "json::value")] &'a Value);
    let value = Value::Object(dump.clone());
    serde_json::to_string(&Pydantic(&value))
        .map(|text| text.chars().count())
        .unwrap_or(usize::MAX)
}

/// `SubmissionCreate`: the submitter's email and the event, which must fit
/// `MAX_EVENT_DATA_BYTES`. Returns the event as validated and as stored.
fn read_create(bytes: &[u8], headers: &HeaderMap) -> Result<(String, EventInput, Value), ApiError> {
    let mut body = Body::parse(bytes, headers, Extra::Forbid)?;
    let email = required_email(&mut body, "submitted_by_email");
    let event = match body.raw("event_data") {
        Input::Missing => {
            body.missing("event_data");
            None
        }
        input => {
            let raw = match input {
                Input::Given(value) => value,
                _ => Value::Null,
            };
            match Body::nested(raw.clone(), body.loc("event_data"), Extra::Forbid) {
                Err(issue) => {
                    body.push_issues(vec![*issue]);
                    None
                }
                Ok(nested) => match requests::event(nested, false) {
                    Err(ApiError::RequestValidation(issues)) => {
                        body.push_issues(issues);
                        None
                    }
                    Err(other) => return Err(other),
                    Ok(input) => {
                        let dump = event_dump(&input);
                        let size = model_json_size(&dump);
                        if size > MAX_EVENT_DATA_BYTES {
                            let loc = body.loc("event_data");
                            body.value_error(
                                loc,
                                raw,
                                &format!(
                                    "event_data exceeds maximum size ({size} bytes, limit {MAX_EVENT_DATA_BYTES})"
                                ),
                            );
                            None
                        } else {
                            Some((input, without_nulls(Value::Object(dump))))
                        }
                    }
                },
            }
        }
    };
    body.finish()?;
    let (input, stored) = event.expect("a valid body has an event");
    Ok((email.expect("a valid body has an email"), input, stored))
}

#[utoipa::path(
    post,
    path = "/submissions/",
    tag = "submissions",
    operation_id = "create_submission_submissions__post",
    summary = "Create Submission"
)]
pub async fn create_submission(
    State(state): State<AppState>,
    ClientIp(client_ip): ClientIp,
    request: Request,
) -> Result<Response, ApiError> {
    let (mut parts, bytes) = json_first(request).await?;
    let OptionalUser(auth_user) = OptionalUser::from_request_parts(&mut parts, &state).await?;
    SUBMISSIONS.check(&client_ip)?;
    let (email, input, event_data) = read_create(&bytes, &parts.headers)?;
    let user = read_optional_user(&state.db, auth_user).await?;
    let club_id = writes::int4(input.club_id.unwrap_or(PyInt::Small(0)))?;
    let school_id = club_school(&state.db, club_id)
        .await?
        .ok_or_else(|| ApiError::validation(SUBMISSION_SCHOOL_REQUIRED))?;
    let row = sqlx::query(&insert_sql())
        .bind(Uuid::new_v4())
        .bind(user.as_ref().map(|user| user.id))
        .bind(&email)
        .bind(event_data)
        .bind(school_id)
        .fetch_one(&state.db)
        .await?;
    Ok((
        StatusCode::CREATED,
        Json(SubmissionResponse::from_row(&row)?),
    )
        .into_response())
}

#[utoipa::path(
    get,
    path = "/submissions/",
    tag = "submissions",
    operation_id = "list_submissions_submissions__get",
    summary = "List Submissions"
)]
pub async fn list_submissions(
    State(state): State<AppState>,
    AdminUser(_): AdminUser,
    query: QueryParams,
) -> Result<Json<Paginated<SubmissionResponse>>, ApiError> {
    let mut check = Validator::default();
    // FastAPI reports the pagination dependency's problems first.
    let pagination = Pagination::read(&mut check, &query);
    let status = check
        .query(&query, "submission_status")
        .optional_string(Length::default().max(MAX_STATUS_FILTER_LENGTH));
    let school = check
        .query(&query, "school")
        .optional_string(Length::default().max(MAX_SCHOOL_LENGTH));
    let search = check
        .query(&query, "search")
        .optional_string(Length::default().max(MAX_SEARCH_QUERY_LENGTH));
    check.finish()?;
    let filters = AdminFilters::new("submissions", search, school, status);
    let sql = admin_page_sql(
        filters.resource,
        &format!(
            "SELECT entries.position, {} FROM entries \
             JOIN public.event_submissions es ON es.id = entries.id::uuid \
             LEFT JOIN public.schools s ON s.id = es.school_id",
            event_columns(true)
        ),
    );
    let rows = read_with_retry(|| {
        sqlx::query(&sql)
            .bind(pagination.page_size)
            .bind(pagination.offset())
            .bind(&filters.search)
            .bind(&filters.school)
            .bind(&filters.status)
            .fetch_all(&state.db)
    })
    .await?;
    let mut total = 0;
    let mut items = Vec::new();
    for row in &rows {
        total = row.try_get("total")?;
        if row.try_get::<Option<String>, _>("id")?.is_some() {
            items.push(SubmissionResponse::from_row(row)?);
        }
    }
    Ok(Json(Paginated::new(items, total, pagination)))
}

/// The `{submission_id}` of a path: any text (`str`).
async fn submission_id(
    state: &AppState,
    parts: &mut axum::http::request::Parts,
) -> Result<String, ApiError> {
    let path = PathParams::from_request_parts(parts, state).await?;
    let mut check = Validator::default();
    let id = check.path(&path, "submission_id").string(Length::default());
    check.finish()?;
    Ok(id)
}

#[utoipa::path(
    get,
    path = "/submissions/{submission_id}",
    tag = "submissions",
    operation_id = "get_submission_submissions__submission_id__get",
    summary = "Get Submission"
)]
pub async fn get_submission_route(
    State(state): State<AppState>,
    AdminUser(_): AdminUser,
    path: PathParams,
) -> Result<Json<SubmissionResponse>, ApiError> {
    let mut check = Validator::default();
    let id = check.path(&path, "submission_id").string(Length::default());
    check.finish()?;
    Ok(Json(get_or_404(
        get_submission(&state.db, &id).await?,
        SUBMISSION_NOT_FOUND,
    )?))
}

/// `update_submission`'s refusal of a decision the submission cannot take.
fn refuse_transition(id: &str, current: &str, requested: &str) -> ApiError {
    let allowed: Vec<String> = allowed(current)
        .iter()
        .map(|status| format!("'{status}'"))
        .collect();
    tracing::warn!(
        "Rejected submission transition {id}: {current} -> {requested} (allowed: [{}])",
        allowed.join(", ")
    );
    ApiError::validation(INVALID_STATUS_TRANSITION)
}

/// `update_submission`: move a submission through review. Approving
/// publishes its event in the same transaction as the new status.
async fn review(
    db: &sqlx::PgPool,
    id: &str,
    status: &str,
    reason: Option<&str>,
    admin: &User,
) -> Result<Option<SubmissionResponse>, ApiError> {
    let Some(existing) = get_submission(db, id).await? else {
        return Ok(None);
    };
    let current = existing.metadata.status.clone();
    if status != current && !allowed(&current).contains(&status) {
        return Err(refuse_transition(id, &current, status));
    }
    if status == current {
        return Ok(Some(existing));
    }
    // Everything the new event needs is read and checked before any write.
    let event = if status == "approved" {
        let nested = Body::nested(existing.event_data.clone(), Vec::new(), Extra::Forbid)
            .map_err(|issue| ApiError::Internal(anyhow::anyhow!("event_data: {issue:?}")))?;
        let input = requests::event(nested, false).map_err(|error| {
            ApiError::Internal(anyhow::anyhow!(
                "stored event_data failed validation: {error:?}"
            ))
        })?;
        let club_id = writes::int4(input.club_id.unwrap_or(PyInt::Small(0)))?;
        let club = writes::club(db, club_id, admin)
            .await?
            .ok_or_else(|| ApiError::not_found(CLUB_NOT_FOUND))?;
        Some((input, club))
    } else {
        None
    };
    let mut transaction = db.begin().await?;
    let locked: Option<String> = sqlx::query_scalar(LOCK_SQL)
        .bind(id)
        .fetch_optional(&mut *transaction)
        .await?;
    match locked {
        None => return Ok(None),
        // Another reviewer decided it first.
        Some(locked) if locked != current => {
            drop(transaction);
            if locked == status {
                return get_submission(db, id).await;
            }
            return Err(refuse_transition(id, &locked, status));
        }
        Some(_) => {}
    }
    let created = match event {
        Some((input, club)) => {
            Some(writes::insert(&mut transaction, input, &club, &admin.id.to_string()).await?)
        }
        None => None,
    };
    let row = sqlx::query(&update_sql())
        .bind(id)
        .bind(status)
        .bind(Utc::now())
        .bind(reason)
        .fetch_optional(&mut *transaction)
        .await?;
    let Some(row) = row else { return Ok(None) };
    let updated = SubmissionResponse::from_row(&row)?;
    transaction.commit().await?;
    if let Some(event_id) = created {
        writes::created(db, event_id).await?;
    }
    let title = existing.event_data["title"]
        .as_str()
        .unwrap_or_default()
        .to_owned();
    let path = created.map_or_else(
        || "/events".to_owned(),
        |event_id| format!("/events/{event_id}"),
    );
    emails::send_review_decision(
        Reviewed::Event,
        &title,
        status,
        existing.metadata.submitted_by_email.as_deref(),
        existing.metadata.school.as_deref(),
        &path,
        reason,
    )
    .await;
    Ok(Some(updated))
}

#[utoipa::path(
    patch,
    path = "/submissions/{submission_id}",
    tag = "submissions",
    operation_id = "update_submission_submissions__submission_id__patch",
    summary = "Update Submission"
)]
pub async fn update_submission(
    State(state): State<AppState>,
    request: Request,
) -> Result<Json<SubmissionResponse>, ApiError> {
    let (mut parts, bytes) = json_first(request).await?;
    let AdminUser(admin) = AdminUser::from_request_parts(&mut parts, &state).await?;
    let id = submission_id(&state, &mut parts).await?;
    let (status, reason) = review_body(&bytes, &parts.headers, Validator::default())?;
    let reviewed = review(&state.db, &id, &status, reason.as_deref(), &admin).await?;
    Ok(Json(get_or_404(reviewed, SUBMISSION_NOT_FOUND)?))
}

#[utoipa::path(
    delete,
    path = "/submissions/{submission_id}",
    tag = "submissions",
    operation_id = "delete_submission_submissions__submission_id__delete",
    summary = "Delete Submission"
)]
pub async fn delete_submission(
    State(state): State<AppState>,
    AdminUser(_): AdminUser,
    path: PathParams,
) -> Result<Response, ApiError> {
    let mut check = Validator::default();
    let id = check.path(&path, "submission_id").string(Length::default());
    check.finish()?;
    let deleted = sqlx::query(DELETE_SQL)
        .bind(&id)
        .execute(&state.db)
        .await?
        .rows_affected();
    if deleted == 0 {
        return Err(ApiError::not_found(SUBMISSION_NOT_FOUND));
    }
    Ok(no_content())
}

#[cfg(test)]
mod database_tests;
#[cfg(test)]
mod tests;
