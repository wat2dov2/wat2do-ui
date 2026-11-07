//! `/position-submissions`: hiring positions sent for admin review
//! (`routers/position_submissions.py`). A position from its club's own
//! management team (or an admin) is published at once.

use std::sync::LazyLock;

use axum::Json;
use axum::extract::{FromRequestParts, Request, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use chrono::{DateTime, FixedOffset, NaiveDate};
use serde::Serialize;
use serde_json::{Map, Value, json};
use sqlx::Row;
use sqlx::postgres::PgRow;
use uuid::Uuid;

use super::{Metadata, STATUSES, allowed, metadata_columns, read_optional_user, review_body};
use crate::api::AppState;
use crate::api::auth::{AdminUser, OptionalUser, User};
use crate::api::body::{Body, Extra, Input, Str, json_first};
use crate::api::client_ip::ClientIp;
use crate::api::errors::{ApiError, get_or_404};
use crate::api::events::writes;
use crate::api::messages::{
    INVALID_STATUS_TRANSITION, POSITION_ALREADY_EXISTS, SUBMISSION_NOT_FOUND,
    SUBMISSION_SCHOOL_REQUIRED,
};
use crate::api::pagination::{Paginated, Pagination};
use crate::api::rate_limit::RateLimiter;
use crate::api::routes::ai::extractor::POSITION_TYPES;
use crate::api::routes::clubs::emails::{self, Reviewed};
use crate::api::validation::{Length, PathParams, PyInt, QueryParams, Validator};
use crate::constants::{
    MAX_POSITION_DESCRIPTION_LENGTH, MAX_POSITION_DETAIL_LENGTH, MAX_POSITION_REQUIREMENT_COUNT,
    MAX_POSITION_REQUIREMENT_LENGTH, MAX_POSITION_TITLE_LENGTH, MAX_SCHOOL_LENGTH,
    MAX_SEARCH_QUERY_LENGTH, MAX_URL_LENGTH,
};
use crate::controlbox::RATE_LIMITS;
use crate::db::read_with_retry;

/// The submission limiter of `POST /position-submissions/`, by client IP.
static SUBMISSIONS: LazyLock<RateLimiter> =
    LazyLock::new(|| RateLimiter::new(RATE_LIMITS.submissions));

/// A validated `PositionCreate`.
#[derive(Debug, Clone, PartialEq)]
pub struct PositionCreate {
    pub title: String,
    pub description: String,
    pub position_type: String,
    pub requirements: Vec<String>,
    pub commitment: Option<String>,
    pub compensation: Option<String>,
    pub is_paid: Option<bool>,
    pub location: Option<String>,
    pub contact_email: Option<String>,
    pub deadline_date: Option<NaiveDate>,
    pub deadline_at: Option<DateTime<FixedOffset>>,
    pub club_id: PyInt,
    /// `club_id` as it was sent, for one too large for 64 bits.
    club_id_value: Value,
    pub source_url: String,
    pub source_image_url: Option<String>,
}

impl PositionCreate {
    /// Read a `PositionCreate` (`extra="forbid"`, every string stripped);
    /// `None` when `body` has a problem, which it records.
    pub fn read(body: &mut Body) -> Option<Self> {
        let text = |max: usize| Str::new().strip().max(max);
        let title = body.required_string("title", &text(MAX_POSITION_TITLE_LENGTH).min(1));
        let description = body.required_string(
            "description",
            &text(MAX_POSITION_DESCRIPTION_LENGTH as usize).min(1),
        );
        // A `Literal` is not stripped.
        let position_type =
            body.required_string("position_type", &Str::new().one_of(POSITION_TYPES));
        let requirements = match body.string_list(
            "requirements",
            &text(MAX_POSITION_REQUIREMENT_LENGTH).min(1),
            MAX_POSITION_REQUIREMENT_COUNT,
        ) {
            Input::Given(items) => Some(items),
            Input::Null => {
                body.type_error("requirements", "list_type", "Input should be a valid list");
                None
            }
            Input::Missing => (!body.has_field("requirements")).then(Vec::new),
        };
        let commitment = body.string("commitment", &text(MAX_POSITION_DETAIL_LENGTH));
        let compensation = body.string("compensation", &text(MAX_POSITION_DETAIL_LENGTH));
        let is_paid = body.bool("is_paid");
        let location = body.string("location", &text(MAX_POSITION_DETAIL_LENGTH));
        let contact_email = body.string("contact_email", &text(320));
        let deadline_date = body.date("deadline_date");
        let deadline_at = body.aware_datetime_with_offset("deadline_at");
        let club_id_value = body.raw_copy("club_id").unwrap_or(Value::Null);
        let club_id = match body.unbounded_int("club_id", Some(1)) {
            Input::Given(club_id) => Some(club_id),
            Input::Null => {
                body.type_error("club_id", "int_type", "Input should be a valid integer");
                None
            }
            Input::Missing => {
                if !body.has_field("club_id") {
                    body.missing("club_id");
                }
                None
            }
        };
        // `safe_url`: each URL must be one pydantic's `HttpUrl` accepts.
        let source_url = body
            .required_string("source_url", &text(MAX_URL_LENGTH).min(1))
            .and_then(|url| {
                let loc = body.loc("source_url");
                body.check_http_url(loc, &url, json!(url)).map(|_| url)
            });
        let source_image_url = match body.string("source_image_url", &text(MAX_URL_LENGTH)) {
            Input::Given(url) => {
                let loc = body.loc("source_image_url");
                body.check_http_url(loc, &url, json!(url))
                    .map(|_| Some(url))
            }
            _ => Some(None),
        };
        body.check_extras();
        if body.has_issues() {
            return None;
        }
        let deadline_at = deadline_at.value();
        let deadline_date = deadline_date.value();
        // `valid_deadline`.
        if deadline_at.is_some() && deadline_date.is_none() {
            body.model_error("deadline_at requires deadline_date");
            return None;
        }
        Some(Self {
            title: title?,
            description: description?,
            position_type: position_type?,
            requirements: requirements?,
            commitment: commitment.value(),
            compensation: compensation.value(),
            is_paid: is_paid.value(),
            location: location.value(),
            contact_email: contact_email.value(),
            deadline_date,
            deadline_at,
            club_id: club_id?,
            club_id_value,
            source_url: source_url?,
            source_image_url: source_image_url?,
        })
    }

    /// The stored `position_data` of a submission row, validated again.
    pub fn stored(value: Value) -> Result<Self, ApiError> {
        let mut body = Body::nested(value, Vec::new(), Extra::Forbid)
            .map_err(|issue| ApiError::Internal(anyhow::anyhow!("position_data: {issue:?}")))?;
        let position = Self::read(&mut body);
        match position {
            Some(position) if !body.has_issues() => Ok(position),
            _ => Err(ApiError::Internal(anyhow::anyhow!(
                "stored position_data failed validation: {:?}",
                body.into_issues()
            ))),
        }
    }

    pub fn club_id_json(&self) -> Value {
        match self.club_id {
            PyInt::Small(id) => json!(id),
            PyInt::Huge => self.club_id_value.clone(),
        }
    }

    /// `model_dump(mode="json")`, without the unset optional fields when
    /// `exclude_none` (the form a submission stores).
    pub fn dump(&self, exclude_none: bool) -> Value {
        let mut map = Map::new();
        let mut put = |name: &str, value: Value| {
            if !(exclude_none && value.is_null()) {
                map.insert(name.to_owned(), value);
            }
        };
        put("title", json!(self.title));
        put("description", json!(self.description));
        put("position_type", json!(self.position_type));
        put("requirements", json!(self.requirements));
        put("commitment", json!(self.commitment));
        put("compensation", json!(self.compensation));
        put("is_paid", json!(self.is_paid));
        put("location", json!(self.location));
        put("contact_email", json!(self.contact_email));
        put(
            "deadline_date",
            json!(
                self.deadline_date
                    .map(|date| date.format("%Y-%m-%d").to_string())
            ),
        );
        put(
            "deadline_at",
            json!(
                self.deadline_at
                    .as_ref()
                    .map(crate::api::json::format_offset_datetime)
            ),
        );
        put("club_id", self.club_id_json());
        put("source_url", json!(self.source_url));
        put("source_image_url", json!(self.source_image_url));
        Value::Object(map)
    }
}

/// `PositionSubmissionCreate`: the submitter's email and the position.
pub(super) fn read_create(
    bytes: &[u8],
    headers: &axum::http::HeaderMap,
) -> Result<(String, PositionCreate), ApiError> {
    let mut body = Body::parse(bytes, headers, Extra::Forbid)?;
    let email = super::required_email(&mut body, "submitted_by_email");
    let position = match body.raw("position_data") {
        Input::Missing => {
            body.missing("position_data");
            None
        }
        input => {
            let value = match input {
                Input::Given(value) => value,
                _ => Value::Null,
            };
            match Body::nested(value, body.loc("position_data"), Extra::Forbid) {
                Err(issue) => {
                    body.push_issues(vec![*issue]);
                    None
                }
                Ok(mut nested) => {
                    let position = PositionCreate::read(&mut nested);
                    body.push_issues(nested.into_issues());
                    position
                }
            }
        }
    };
    body.finish()?;
    Ok((
        email.expect("a valid body has an email"),
        position.expect("a valid body has a position"),
    ))
}

/// `PositionSubmissionResponse`.
#[derive(Debug, Serialize)]
pub struct PositionSubmissionResponse {
    #[serde(flatten)]
    metadata: Metadata,
    position_data: Value,
}

impl PositionSubmissionResponse {
    fn from_row(row: &PgRow) -> Result<Self, ApiError> {
        let position = PositionCreate::stored(row.try_get::<Value, _>("position_data")?)?;
        Ok(Self {
            metadata: Metadata::from_row(row)?,
            position_data: position.dump(false),
        })
    }
}

const POSITION_COLUMNS: &str = "ps.position_data";

/// A new pending position submission, returned as written.
pub(super) fn insert_sql() -> String {
    format!(
        "INSERT INTO public.position_submissions AS ps \
             (id, user_id, submitted_by_email, position_data, school_id, status) \
         VALUES ($1, $2, $3, $4, $5, 'pending') RETURNING {}, {POSITION_COLUMNS}",
        metadata_columns("ps", "NULL::text")
    )
}

/// The decision, through `review_position_submission`.
pub(super) fn review_sql() -> String {
    format!(
        "SELECT {}, {POSITION_COLUMNS} FROM public.review_position_submission($1, $2, $3, $4) ps",
        metadata_columns("ps", "NULL::text")
    )
}

/// `get_submission_by_id(kind="position")`, with the school's slug.
async fn get_submission(
    db: &sqlx::PgPool,
    id: Uuid,
) -> Result<Option<(PositionSubmissionResponse, PositionCreate)>, ApiError> {
    let sql = format!(
        "SELECT {}, {POSITION_COLUMNS} FROM public.position_submissions ps \
         LEFT JOIN public.schools s ON s.id = ps.school_id WHERE ps.id = $1",
        metadata_columns("ps", "NULLIF(s.slug, '')")
    );
    let row = read_with_retry(|| sqlx::query(&sql).bind(id).fetch_optional(db)).await?;
    let Some(row) = row else { return Ok(None) };
    let position = PositionCreate::stored(row.try_get::<Value, _>("position_data")?)?;
    Ok(Some((
        PositionSubmissionResponse::from_row(&row)?,
        position,
    )))
}

/// `review_position_submission`: decide one position submission through
/// the `review_position_submission` function, which publishes an approved
/// position in the same transaction. `None` when it does not exist.
pub async fn review(
    db: &sqlx::PgPool,
    id: Uuid,
    status: &str,
    reason: Option<&str>,
    reviewer: &User,
    notify_submitter: bool,
) -> Result<Option<PositionSubmissionResponse>, ApiError> {
    let Some((existing, position)) = get_submission(db, id).await? else {
        return Ok(None);
    };
    if status != existing.metadata.status && !allowed(&existing.metadata.status).contains(&status) {
        return Err(ApiError::validation(INVALID_STATUS_TRANSITION));
    }
    let row = sqlx::query(&review_sql())
        .bind(id)
        .bind(status)
        .bind(reason)
        .bind(reviewer.id)
        .fetch_optional(db)
        .await
        .map_err(
            |error| match error.as_database_error().and_then(|error| error.code()) {
                Some(code) if code == "23514" => ApiError::validation(INVALID_STATUS_TRANSITION),
                Some(code) if code == "23505" => ApiError::validation(POSITION_ALREADY_EXISTS),
                _ => ApiError::from(error),
            },
        )?;
    let Some(row) = row else { return Ok(None) };
    if notify_submitter && status != existing.metadata.status {
        emails::send_review_decision(
            Reviewed::Position,
            &position.title,
            status,
            existing.metadata.submitted_by_email.as_deref(),
            existing.metadata.school.as_deref(),
            "/positions",
            reason,
        )
        .await;
    }
    if status == "approved"
        && let PyInt::Small(club_id) = position.club_id
        && let Some(club) = crate::api::routes::clubs::get_club(db, club_id).await?
    {
        let schools: Vec<String> = club.school.into_iter().collect();
        crate::revalidation::revalidate_schools(&schools, &["positions", "clubs"]).await;
    }
    let mut response = PositionSubmissionResponse::from_row(&row)?;
    response.metadata.submitted_by_email = existing.metadata.submitted_by_email;
    Ok(Some(response))
}

#[utoipa::path(
    post,
    path = "/position-submissions/",
    tag = "position-submissions",
    operation_id = "create_submission_position_submissions__post",
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
    let (email, position) = read_create(&bytes, &parts.headers)?;
    let user = read_optional_user(&state.db, auth_user).await?;
    let club_id = writes::int4(position.club_id)?;
    let school_id = super::club_school(&state.db, club_id)
        .await?
        .ok_or_else(|| ApiError::validation(SUBMISSION_SCHOOL_REQUIRED))?;
    let row = sqlx::query(&insert_sql())
        .bind(Uuid::new_v4())
        .bind(user.as_ref().map(|user| user.id))
        .bind(&email)
        .bind(position.dump(true))
        .bind(school_id)
        .fetch_one(&state.db)
        .await?;
    let submission = PositionSubmissionResponse::from_row(&row)?;
    // The club's own management team publishes straight away, as with events.
    if let Some(user) = &user
        && let Some(club) = writes::club(&state.db, club_id, user).await?
        && writes::publish_refusal(&club, user).is_none()
    {
        let id = Uuid::parse_str(&submission.metadata.id)
            .map_err(|error| ApiError::Internal(error.into()))?;
        let published = review(&state.db, id, "approved", None, user, false)
            .await?
            .ok_or_else(|| ApiError::Internal(anyhow::anyhow!("submission {id} vanished")))?;
        return Ok((StatusCode::CREATED, Json(published)).into_response());
    }
    Ok((StatusCode::CREATED, Json(submission)).into_response())
}

#[utoipa::path(
    get,
    path = "/position-submissions/",
    tag = "position-submissions",
    operation_id = "list_submissions_position_submissions__get",
    summary = "List Submissions"
)]
pub async fn list_submissions(
    State(state): State<AppState>,
    AdminUser(_): AdminUser,
    query: QueryParams,
) -> Result<Json<Paginated<PositionSubmissionResponse>>, ApiError> {
    let mut check = Validator::default();
    // FastAPI reports the pagination dependency's problems first.
    let pagination = Pagination::read(&mut check, &query);
    let status = check
        .query(&query, "submission_status")
        .optional_choice(STATUSES);
    let school = check
        .query(&query, "school")
        .optional_string(Length::default().max(MAX_SCHOOL_LENGTH));
    let search = check
        .query(&query, "search")
        .optional_string(Length::default().max(MAX_SEARCH_QUERY_LENGTH));
    check.finish()?;
    let school_id = match school.as_deref().filter(|school| !school.is_empty()) {
        Some(school) => match crate::api::events::store::school_id(&state.db, school).await? {
            Some(id) => Some(id),
            None => return Ok(Json(Paginated::new(Vec::new(), 0, pagination))),
        },
        None => None,
    };
    let title = search
        .as_deref()
        .map(crate::text::python_strip)
        .filter(|search| !search.is_empty())
        .map(|search| format!("%{}%", crate::text::sanitize_postgrest_value(search)));
    let sql = format!(
        "WITH matched AS ( \
             SELECT ps.* FROM public.position_submissions ps \
             WHERE ($1::text IS NULL OR ps.position_data->>'title' ILIKE $1) \
               AND ($2::text IS NULL OR ps.status = $2) \
               AND ($3::int8 IS NULL OR ps.school_id = $3)) \
         SELECT (SELECT count(*) FROM matched) AS total, page.* FROM (SELECT 1) AS one \
         LEFT JOIN LATERAL (SELECT {}, {POSITION_COLUMNS} FROM matched ps \
             LEFT JOIN public.schools s ON s.id = ps.school_id \
             ORDER BY ps.submitted_at DESC OFFSET $4 LIMIT $5) AS page ON true",
        metadata_columns("ps", "NULLIF(s.slug, '')")
    );
    let rows = read_with_retry(|| {
        sqlx::query(&sql)
            .bind(&title)
            .bind(status.as_deref().filter(|status| !status.is_empty()))
            .bind(school_id)
            .bind(pagination.offset())
            .bind(pagination.page_size)
            .fetch_all(&state.db)
    })
    .await?;
    let mut total = 0;
    let mut items = Vec::new();
    for row in &rows {
        total = row.try_get("total")?;
        if row.try_get::<Option<String>, _>("id")?.is_some() {
            items.push(PositionSubmissionResponse::from_row(row)?);
        }
    }
    Ok(Json(Paginated::new(items, total, pagination)))
}

#[utoipa::path(
    patch,
    path = "/position-submissions/{submission_id}",
    tag = "position-submissions",
    operation_id = "review_submission_position_submissions__submission_id__patch",
    summary = "Review Submission"
)]
pub async fn review_submission(
    State(state): State<AppState>,
    request: Request,
) -> Result<Json<PositionSubmissionResponse>, ApiError> {
    let (mut parts, bytes) = json_first(request).await?;
    let AdminUser(admin) = AdminUser::from_request_parts(&mut parts, &state).await?;
    let path = PathParams::from_request_parts(&mut parts, &state).await?;
    let mut check = Validator::default();
    let id = check.path(&path, "submission_id").uuid();
    let (status, reason) = review_body(&bytes, &parts.headers, check)?;
    let reviewed = review(&state.db, id, &status, reason.as_deref(), &admin, true).await?;
    Ok(Json(get_or_404(reviewed, SUBMISSION_NOT_FOUND)?))
}
