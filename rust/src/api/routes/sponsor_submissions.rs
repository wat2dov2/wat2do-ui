//! `/sponsor-submissions`: public nominations of businesses to support
//! students, kept apart from contact mail and reviewed once by an admin
//! (`routers/sponsor_submissions.py`, `services/sponsor_submission_service.py`).

use std::sync::LazyLock;

use axum::Json;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::Row;
use sqlx::postgres::PgRow;
use utoipa::ToSchema;

use crate::api::AppState;
use crate::api::auth::AdminUser;
use crate::api::body::{Body, Extra, Str, merge_issues};
use crate::api::client_ip::ClientIp;
use crate::api::errors::ApiError;
use crate::api::json;
use crate::api::messages::{
    INVALID_STATUS_TRANSITION, SPONSOR_SUBMISSION_NOT_FOUND, SUBMISSION_SCHOOL_REQUIRED,
};
use crate::api::pagination::{Paginated, Pagination};
use crate::api::rate_limit::RateLimiter;
use crate::api::routes::auth::MessageResponse;
use crate::api::routes::contact::{
    ContactMessage, contact_email, read_contact_fields, required_text,
};
use crate::api::validation::{Length, PathParams, QueryParams, Validator};
use crate::constants::{MAX_SCHOOL_LENGTH, MAX_SEARCH_QUERY_LENGTH};
use crate::controlbox::CONTACT;
use crate::db::read_with_retry;
use crate::schools::{name_pattern, normalize_slug, school_id_sql};
use crate::text::{python_strip, sanitize_postgrest_value};

/// The contact form's budget, counted separately.
static LIMITER: LazyLock<RateLimiter> = LazyLock::new(|| RateLimiter::new(CONTACT.rate_limit));

const STATUSES: &[&str] = &["pending", "approved", "rejected"];
const REVIEW_STATUSES: &[&str] = &["approved", "rejected"];

/// A validated `SponsorSubmissionCreate`.
#[derive(Debug, PartialEq)]
struct Nomination {
    contact: ContactMessage,
    school: String,
    business_name: String,
}

/// `SponsorSubmissionCreate`: `ContactCreate`'s fields, then the school and business.
fn parse_nomination(mut body: Body) -> Result<Nomination, ApiError> {
    let (email, message) = read_contact_fields(&mut body);
    let school = required_text(&mut body, "school", MAX_SCHOOL_LENGTH);
    let business_name = required_text(
        &mut body,
        "business_name",
        CONTACT.business_support.business_name,
    );
    body.finish()?;
    match (email, message, school, business_name) {
        (Some(email), Some(message), Some(school), Some(business_name)) => Ok(Nomination {
            contact: ContactMessage { email, message },
            school,
            business_name,
        }),
        _ => Err(ApiError::Internal(anyhow::anyhow!(
            "validated body is incomplete"
        ))),
    }
}

/// `school_service.get_school_id`: by slug, else by name.
async fn school_id(db: &sqlx::PgPool, school: &str) -> Result<Option<i32>, sqlx::Error> {
    let slug = normalize_slug(school);
    let name = name_pattern(school);
    let sql = format!("SELECT {}", school_id_sql("$1", "$2"));
    read_with_retry(|| {
        sqlx::query_scalar::<_, Option<i32>>(&sql)
            .bind(&slug)
            .bind(&name)
            .fetch_one(db)
    })
    .await
}

#[allow(dead_code)]
#[derive(ToSchema)]
pub struct SponsorSubmissionCreate {
    #[schema(format = Email)]
    email: String,
    #[schema(min_length = 1, max_length = 5000)]
    message: String,
    #[schema(min_length = 1, max_length = 255)]
    school: String,
    #[schema(min_length = 1, max_length = 120)]
    business_name: String,
}

#[utoipa::path(
    post,
    path = "/sponsor-submissions/",
    tag = "sponsor-submissions",
    operation_id = "create_submission_sponsor_submissions__post",
    summary = "Create Submission",
    request_body = SponsorSubmissionCreate,
    responses(
        (status = 201, description = "Successful Response", body = MessageResponse),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn create_submission(
    State(state): State<AppState>,
    ClientIp(client_ip): ClientIp,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<(StatusCode, Json<MessageResponse>), ApiError> {
    LIMITER.check(&client_ip)?;
    let nomination = parse_nomination(Body::parse(&bytes, &headers, Extra::Forbid)?)?;
    let school_id = school_id(&state.db, &nomination.school)
        .await?
        .ok_or_else(|| ApiError::validation(SUBMISSION_SCHOOL_REQUIRED))?;
    sqlx::query(
        "INSERT INTO public.sponsor_submissions (email, message, school_id, business_name, status) \
         VALUES ($1, $2, $3, $4, 'pending')",
    )
    .bind(&nomination.contact.email)
    .bind(&nomination.contact.message)
    .bind(school_id)
    .bind(&nomination.business_name)
    .execute(&state.db)
    .await?;
    // Stored first: the team is only told about a nomination that was kept.
    crate::email::send_in_background(contact_email(&nomination.contact));
    Ok((
        StatusCode::CREATED,
        MessageResponse::json("Sponsor submission received"),
    ))
}

// `SponsorSubmissionResponse`.
#[derive(Debug, Serialize, ToSchema)]
pub struct SponsorSubmissionResponse {
    #[schema(format = Email)]
    pub email: String,
    #[schema(min_length = 1, max_length = 5000)]
    pub message: String,
    #[schema(min_length = 1, max_length = 255)]
    pub school: String,
    #[schema(min_length = 1, max_length = 120)]
    pub business_name: String,
    pub id: String,
    #[schema(value_type = SubmissionStatus, inline)]
    pub status: String,
    #[schema(value_type = String, format = DateTime)]
    #[serde(serialize_with = "json::datetime")]
    pub submitted_at: DateTime<Utc>,
    #[schema(value_type = Option<String>, format = DateTime)]
    #[serde(serialize_with = "json::option_datetime")]
    pub reviewed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Copy, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum SubmissionStatus {
    Pending,
    Approved,
    Rejected,
}

/// The columns of a response row, `s` being the submission.
const COLUMNS: &str = "s.id::text AS id, s.email, s.message, s.business_name, s.status, \
     s.submitted_at, s.reviewed_at, \
     (SELECT NULLIF(slug, '') FROM public.schools WHERE id = s.school_id) AS school";

impl SponsorSubmissionResponse {
    fn from_row(row: &PgRow) -> Result<Self, ApiError> {
        let id: String = row.try_get("id")?;
        // `school: str` in the response model: a row without one fails.
        let school: Option<String> = row.try_get("school")?;
        Ok(Self {
            email: row.try_get("email")?,
            message: row.try_get("message")?,
            school: school.ok_or_else(|| {
                ApiError::Internal(anyhow::anyhow!("sponsor submission {id} has no school"))
            })?,
            business_name: row.try_get("business_name")?,
            status: row.try_get("status")?,
            submitted_at: row.try_get("submitted_at")?,
            reviewed_at: row.try_get("reviewed_at")?,
            id,
        })
    }
}

crate::paginated_schema!(
    PaginatedSponsorSubmissions,
    PaginatedResponse_SponsorSubmissionResponse_,
    SponsorSubmissionResponse
);

#[utoipa::path(
    get,
    path = "/sponsor-submissions/",
    tag = "sponsor-submissions",
    operation_id = "list_submissions_sponsor_submissions__get",
    summary = "List Submissions",
    params(
        ("submission_status" = inline(Option<SubmissionStatus>), Query, nullable),
        ("school" = Option<String>, Query, nullable, max_length = 255),
        ("search" = Option<String>, Query, nullable, max_length = 200),
        ("page" = Option<i64>, Query, minimum = 1, maximum = 1000, description = "Page number (1-indexed)"),
        ("page_size" = Option<i64>, Query, minimum = 1, maximum = 100, description = "Items per page (max 100)"),
    ),
    responses(
        (status = 200, description = "Successful Response", body = PaginatedSponsorSubmissions),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn list_submissions(
    State(state): State<AppState>,
    AdminUser(_): AdminUser,
    query: QueryParams,
) -> Result<Json<Paginated<SponsorSubmissionResponse>>, ApiError> {
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
    let school_id = match school.filter(|school| !school.is_empty()) {
        Some(school) => match school_id(&state.db, &school).await? {
            Some(id) => Some(id),
            // An unknown school has no submissions.
            None => return Ok(Json(Paginated::new(Vec::new(), 0, pagination))),
        },
        None => None,
    };
    let status = status.filter(|status| !status.is_empty());
    let term = search
        .as_deref()
        .map(python_strip)
        .filter(|search| !search.is_empty())
        .map(sanitize_postgrest_value);
    let sql = format!(
        "WITH matched AS ( \
             SELECT s.id, s.submitted_at FROM public.sponsor_submissions s \
             WHERE ($3::text IS NULL OR s.status = $3) \
               AND ($4::int IS NULL OR s.school_id = $4) \
               AND ($5::text IS NULL OR s.business_name ILIKE '%' || $5 || '%')), \
         page AS ( \
             SELECT {COLUMNS} FROM matched m JOIN public.sponsor_submissions s ON s.id = m.id \
             ORDER BY m.submitted_at DESC, m.id ASC LIMIT $1 OFFSET $2) \
         SELECT (SELECT count(*) FROM matched) AS total, page.* \
         FROM (SELECT 1) AS one LEFT JOIN page ON true \
         ORDER BY page.submitted_at DESC, page.id ASC"
    );
    let rows = read_with_retry(|| {
        sqlx::query(&sql)
            .bind(pagination.page_size)
            .bind(pagination.offset())
            .bind(&status)
            .bind(school_id)
            .bind(&term)
            .fetch_all(&state.db)
    })
    .await?;
    let mut total = 0;
    let mut items = Vec::new();
    for row in rows {
        total = row.try_get::<i64, _>("total")?;
        if row.try_get::<Option<String>, _>("id")?.is_some() {
            items.push(SponsorSubmissionResponse::from_row(&row)?);
        }
    }
    Ok(Json(Paginated::new(items, total, pagination)))
}

#[allow(dead_code)]
#[derive(ToSchema)]
pub struct SponsorSubmissionReview {
    #[schema(inline)]
    status: ReviewStatus,
}

#[derive(ToSchema)]
#[serde(rename_all = "lowercase")]
#[allow(dead_code)]
enum ReviewStatus {
    Approved,
    Rejected,
}

#[utoipa::path(
    patch,
    path = "/sponsor-submissions/{submission_id}",
    tag = "sponsor-submissions",
    operation_id = "review_submission_sponsor_submissions__submission_id__patch",
    summary = "Review Submission",
    params(("submission_id" = uuid::Uuid, Path)),
    request_body = SponsorSubmissionReview,
    responses(
        (status = 200, description = "Successful Response", body = SponsorSubmissionResponse),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn review_submission(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    path: PathParams,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<Json<SponsorSubmissionResponse>, ApiError> {
    let mut check = Validator::default();
    let id = check.path(&path, "submission_id").uuid();
    let status = match Body::parse(&bytes, &headers, Extra::Forbid) {
        Ok(mut body) => {
            let status = body.required_string("status", &Str::new().one_of(REVIEW_STATUSES));
            merge_issues(check, body.finish())?;
            status
        }
        // A missing body is reported with the path's problems, as FastAPI does.
        Err(error) => return Err(merge_issues::<()>(check, Err(error)).expect_err("an error")),
    };
    let status = status.ok_or_else(|| ApiError::Internal(anyhow::anyhow!("no review status")))?;
    // The pending predicate makes competing reviews atomic: only one can win.
    let reviewed = sqlx::query(&format!(
        "UPDATE public.sponsor_submissions s SET status = $2, reviewed_at = $3, reviewed_by = $4 \
         WHERE s.id = $1 AND s.status = 'pending' RETURNING {COLUMNS}"
    ))
    .bind(id)
    .bind(&status)
    .bind(Utc::now())
    .bind(admin.id)
    .fetch_optional(&state.db)
    .await?;
    if let Some(row) = reviewed {
        return Ok(Json(SponsorSubmissionResponse::from_row(&row)?));
    }
    let exists = read_with_retry(|| {
        sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS (SELECT 1 FROM public.sponsor_submissions WHERE id = $1)",
        )
        .bind(id)
        .fetch_one(&state.db)
    })
    .await?;
    Err(if exists {
        ApiError::conflict(INVALID_STATUS_TRANSITION)
    } else {
        ApiError::not_found(SPONSOR_SUBMISSION_NOT_FOUND)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    fn data(changes: Value) -> Value {
        let mut body = json!({
            "email": "student@example.com",
            "message": "Needs support",
            "school": "uwaterloo",
            "business_name": "Campus Cafe",
        });
        for (key, value) in changes.as_object().unwrap() {
            body[key] = value.clone();
        }
        body
    }

    fn parse(value: Value) -> Result<Nomination, ApiError> {
        parse_nomination(Body::from_value(value, Extra::Forbid))
    }

    #[test]
    fn nominations_keep_stripped_fields() {
        let nomination = parse(data(
            json!({"school": " uwaterloo ", "business_name": " Campus Cafe "}),
        ))
        .unwrap();
        assert_eq!(nomination.school, "uwaterloo");
        assert_eq!(nomination.business_name, "Campus Cafe");
        assert_eq!(nomination.contact.email, "student@example.com");
    }

    #[test]
    fn invalid_or_client_controlled_review_data_is_rejected() {
        // test_invalid_or_client_controlled_review_data_is_rejected
        for changes in [
            json!({"email": "bad"}),
            json!({"business_name": "  "}),
            json!({"school": ""}),
            json!({"status": "approved"}),
            json!({"business_name": "x".repeat(121)}),
            json!({"school": null}),
        ] {
            assert!(
                matches!(parse(data(changes.clone())), Err(ApiError::RequestValidation(ref issues)) if issues.len() == 1),
                "{changes}"
            );
        }
    }

    #[test]
    fn response_fields_follow_the_model_order() {
        let response = SponsorSubmissionResponse {
            email: "student@example.com".into(),
            message: "Needs support".into(),
            school: "uwaterloo".into(),
            business_name: "Campus Cafe".into(),
            id: "77777777-7777-4777-8777-777777777771".into(),
            status: "pending".into(),
            submitted_at: DateTime::parse_from_rfc3339("2026-09-29T00:00:00Z")
                .unwrap()
                .with_timezone(&Utc),
            reviewed_at: None,
        };
        assert_eq!(
            serde_json::to_string(&response).unwrap(),
            r#"{"email":"student@example.com","message":"Needs support","school":"uwaterloo","business_name":"Campus Cafe","id":"77777777-7777-4777-8777-777777777771","status":"pending","submitted_at":"2026-09-29T00:00:00Z","reviewed_at":null}"#
        );
    }
}
