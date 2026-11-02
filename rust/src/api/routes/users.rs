//! `/users`: the signed-in profile, promoter enrollment, and the admin user
//! list (`routers/users.py`, `services/user_service.py`).

use axum::Json;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use base64::Engine;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::postgres::PgRow;
use sqlx::{FromRow, Row};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::api::AppState;
use crate::api::auth::{AdminUser, CurrentUser, DbUser, ROLE_ADMIN};
use crate::api::body::{Body, Extra, Input, Str, merge_issues};
use crate::api::errors::{ApiError, get_or_404};
use crate::api::json;
use crate::api::messages::{
    CANNOT_DELETE_SELF, LAST_ADMIN_REQUIRED, PROMOTER_PROGRAM_PAUSED, PROMOTER_SCHOOL_REQUIRED,
    PROMOTER_TOS_REQUIRED, USER_HAS_PAYOUT_REVIEWS, USER_HAS_PAYOUTS, USER_HAS_PROMOTER_POSTERS,
    USER_NOT_FOUND, USER_PROFILE_NOT_FOUND,
};
use crate::api::validation::{Limits, PathParams, QueryParams, Validator};
use crate::constants::{
    MAX_AVATAR_URL_LENGTH, MAX_FACULTY_LENGTH, MAX_FULL_NAME_LENGTH, MAX_INTEREST_LENGTH,
    MAX_INTERESTS_COUNT, MAX_LIST_LIMIT, MAX_SCHOOL_LENGTH,
};
use crate::controlbox::PROMOTER_PROGRAM;
use crate::db::read_with_retry;
use crate::schools::normalize_slug;

const SCHOOL_NOT_REGISTERED: &str = "School is not registered";
const FACULTY_NOT_OFFERED: &str = "Faculty is not offered by the selected school";
const ROLES: &[&str] = &["user", "admin"];

/// `avatar_url_for_user`: an uploaded photo, or a stable identicon built from the id.
pub fn avatar_url_for_user(user_id: &str, avatar_url: Option<&str>) -> String {
    if let Some(url) = avatar_url.filter(|url| !url.is_empty()) {
        return url.to_owned();
    }
    let digest = Sha256::digest(user_id.as_bytes());
    let hue = u16::from_be_bytes([digest[0], digest[1]]) % 360;
    let mut cells = String::new();
    for y in 0..5 {
        for x in 0..3 {
            if digest[2 + y * 3 + x] & 1 == 1 {
                // Python iterates the set {x, 4 - x}: ascending, once for the middle column.
                let mut columns = vec![x, 4 - x];
                columns.dedup();
                for column in columns {
                    cells.push_str(&format!(
                        "M{} {}h16v16h-16z",
                        10 + column * 16,
                        10 + y * 16
                    ));
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

/// `UserResponse`, in the model's field order. It also reads a stored
/// `users` row as JSON (an embedded claimant), which has no `school`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct UserResponse {
    pub email: String,
    #[schema(max_length = 255)]
    pub full_name: Option<String>,
    #[schema(max_length = 2048)]
    pub avatar_url: Option<String>,
    #[schema(value_type = String, format = Uuid)]
    pub id: Uuid,
    pub faculty: Option<String>,
    #[serde(default)]
    pub school: Option<String>,
    #[schema(value_type = Option<Vec<String>>)]
    #[serde(serialize_with = "json::option_value", default)]
    pub interests: Option<Value>,
    pub is_first_year: bool,
    #[schema(value_type = UserRole, inline)]
    pub role: String,
    #[schema(value_type = Option<String>, format = Email)]
    pub payout_email: Option<String>,
    #[schema(value_type = Option<String>, format = DateTime)]
    #[serde(serialize_with = "json::option_datetime")]
    pub promoter_tos_accepted_at: Option<DateTime<Utc>>,
    pub promoter_tos_version: Option<String>,
    #[schema(value_type = String, format = DateTime)]
    #[serde(serialize_with = "json::datetime")]
    pub created_at: DateTime<Utc>,
    #[schema(value_type = String, format = DateTime)]
    #[serde(serialize_with = "json::datetime")]
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum UserRole {
    User,
    Admin,
}

/// The `users` columns a `UserResponse` reads (`users.*`), qualified by `alias`.
pub fn user_columns(alias: &str) -> String {
    [
        "id",
        "email",
        "full_name",
        "avatar_url",
        "faculty",
        "interests",
        "is_first_year",
        "role",
        "payout_email",
        "promoter_tos_accepted_at",
        "promoter_tos_version",
        "created_at",
        "updated_at",
    ]
    .iter()
    .map(|column| format!("{alias}.{column}"))
    .collect::<Vec<_>>()
    .join(", ")
}

impl UserResponse {
    /// A row of `user_columns` plus `school` (the slug, or NULL), exactly as
    /// stored: no generated avatar.
    pub fn from_stored(row: &PgRow) -> Result<Self, sqlx::Error> {
        Ok(Self {
            email: row.try_get("email")?,
            full_name: row.try_get("full_name")?,
            avatar_url: row.try_get("avatar_url")?,
            id: row.try_get("id")?,
            faculty: row.try_get("faculty")?,
            school: row.try_get("school")?,
            interests: row
                .try_get::<Option<sqlx::types::Json<Value>>, _>("interests")?
                .map(|json| json.0),
            is_first_year: row.try_get("is_first_year")?,
            role: row.try_get("role")?,
            payout_email: row.try_get("payout_email")?,
            promoter_tos_accepted_at: row.try_get("promoter_tos_accepted_at")?,
            promoter_tos_version: row.try_get("promoter_tos_version")?,
            created_at: row.try_get("created_at")?,
            updated_at: row.try_get("updated_at")?,
        })
    }

    /// `_user_response`: the stored row with the generated avatar when none is set.
    pub fn from_row(row: &PgRow) -> Result<Self, sqlx::Error> {
        let mut user = Self::from_stored(row)?;
        user.avatar_url = Some(avatar_url_for_user(
            &user.id.to_string(),
            user.avatar_url.as_deref(),
        ));
        Ok(user)
    }
}

impl<'r> FromRow<'r, PgRow> for UserResponse {
    fn from_row(row: &'r PgRow) -> Result<Self, sqlx::Error> {
        Self::from_row(row)
    }
}

/// `SELECT users.*, school slug` for one user matching `condition` (on `u`).
fn user_query(condition: &str) -> String {
    format!(
        "SELECT {}, NULLIF(s.slug, '') AS school FROM public.users u \
         LEFT JOIN public.schools s ON s.id = u.school_id WHERE {condition}",
        user_columns("u")
    )
}

/// `user_service.get_user`.
pub async fn get_user(db: &sqlx::PgPool, id: Uuid) -> Result<Option<UserResponse>, ApiError> {
    let sql = user_query("u.id = $1 LIMIT 1");
    Ok(read_with_retry(|| sqlx::query_as::<_, UserResponse>(&sql).bind(id).fetch_optional(db)).await?)
}

/// `user_service.get_user_by_email`: an exact, case-sensitive match.
pub async fn get_user_by_email(
    db: &sqlx::PgPool,
    email: &str,
) -> Result<Option<UserResponse>, ApiError> {
    let sql = user_query("u.email = $1 LIMIT 1");
    Ok(read_with_retry(|| {
        sqlx::query_as::<_, UserResponse>(&sql)
            .bind(email)
            .fetch_optional(db)
    })
    .await?)
}

#[utoipa::path(
    get,
    path = "/users/me",
    tag = "users",
    operation_id = "get_me_users_me_get",
    summary = "Get Me",
    responses((status = 200, description = "Successful Response", body = UserResponse))
)]
pub async fn get_me(
    State(state): State<AppState>,
    CurrentUser(auth_user): CurrentUser,
) -> Result<Json<UserResponse>, ApiError> {
    let sql = user_query("u.supabase_auth_id = $1 LIMIT 1");
    let user = read_with_retry(|| {
        sqlx::query_as::<_, UserResponse>(&sql)
            .bind(&auth_user.id)
            .fetch_optional(&state.db)
    })
    .await?;
    Ok(Json(get_or_404(user, USER_PROFILE_NOT_FOUND)?))
}

/// A validated `UserUpdate`; each field is `Missing` unless sent.
#[derive(Debug, Default)]
struct UserUpdate {
    full_name: Option<Input<String>>,
    avatar_url: Option<Input<String>>,
    faculty: Option<Input<String>>,
    school: Option<Input<String>>,
    interests: Option<Input<Vec<String>>>,
    is_first_year: Option<Input<bool>>,
}

impl UserUpdate {
    /// `UserUpdate` (`full_profile`) or `UserProfileUpdate`; both forbid unknown keys.
    fn parse(mut body: Body, full_profile: bool) -> Result<Self, ApiError> {
        let mut update = Self::default();
        if full_profile {
            update.full_name = Some(body.string("full_name", &Str::new().max(MAX_FULL_NAME_LENGTH)));
            update.avatar_url =
                Some(body.string("avatar_url", &Str::new().max(MAX_AVATAR_URL_LENGTH)));
        }
        update.faculty = Some(body.string("faculty", &Str::new().max(MAX_FACULTY_LENGTH)));
        update.school = Some(body.string("school", &Str::new().max(MAX_SCHOOL_LENGTH)));
        update.interests = Some(body.string_list(
            "interests",
            &Str::new().min(1).max(MAX_INTEREST_LENGTH),
            MAX_INTERESTS_COUNT,
        ));
        update.is_first_year = Some(body.bool("is_first_year"));
        body.finish()?;
        Ok(update)
    }
}

fn set(input: &Option<Input<impl Clone>>) -> bool {
    input.as_ref().is_some_and(Input::is_set)
}

/// The school a profile change names: (id, faculties) of the registered slug.
async fn school_by_slug(
    db: &sqlx::PgPool,
    slug: &str,
) -> Result<Option<(i32, Vec<String>)>, ApiError> {
    if slug.is_empty() {
        return Ok(None);
    }
    Ok(read_with_retry(|| {
        sqlx::query_as::<_, (i32, Vec<String>)>(
            "SELECT id, faculties FROM public.schools WHERE slug = $1 LIMIT 1",
        )
        .bind(slug)
        .fetch_optional(db)
    })
    .await?)
}

/// `update_user`: change only the fields sent; a school must be registered
/// and a faculty offered by the (new or current) school.
async fn update_user(
    db: &sqlx::PgPool,
    user_id: Uuid,
    data: UserUpdate,
) -> Result<Option<UserResponse>, ApiError> {
    let Some(existing) = get_user(db, user_id).await? else {
        return Ok(None);
    };
    let fields = [
        set(&data.full_name),
        set(&data.avatar_url),
        set(&data.faculty),
        set(&data.school),
        set(&data.interests),
        set(&data.is_first_year),
    ];
    if !fields.contains(&true) {
        return Ok(Some(existing));
    }
    let school_input = data.school.clone().unwrap_or(Input::Missing);
    let mut school = None;
    if school_input.is_set() {
        let slug = normalize_slug(school_input.clone().value().as_deref().unwrap_or_default());
        school = Some(
            school_by_slug(db, &slug)
                .await?
                .ok_or_else(|| ApiError::validation(SCHOOL_NOT_REGISTERED))?,
        );
    }
    let faculty_input = data.faculty.clone().unwrap_or(Input::Missing);
    let mut clear_faculty = false;
    match &faculty_input {
        Input::Given(faculty) if !faculty.is_empty() => {
            let target = match &school {
                Some(school) => Some(school.clone()),
                None => {
                    school_by_slug(db, &normalize_slug(existing.school.as_deref().unwrap_or_default()))
                        .await?
                }
            };
            if !target.is_some_and(|(_, faculties)| faculties.contains(faculty)) {
                return Err(ApiError::validation(FACULTY_NOT_OFFERED));
            }
        }
        Input::Missing => {
            if let Some((_, faculties)) = &school {
                clear_faculty = !existing
                    .faculty
                    .as_ref()
                    .is_some_and(|faculty| faculties.contains(faculty));
            }
        }
        _ => {}
    }
    // SET only what was sent, in UserUpdate's field order.
    let mut assignments = Vec::new();
    let mut index = 2;
    let mut next = |column: &str| {
        let assignment = format!("{column} = ${index}");
        index += 1;
        assignment
    };
    let text = |input: &Option<Input<String>>| input.clone().and_then(|input| match input {
        Input::Missing => None,
        other => Some(other.value()),
    });
    let full_name = text(&data.full_name);
    let avatar_url = text(&data.avatar_url);
    let faculty = text(&data.faculty);
    let interests = data.interests.clone().and_then(|input| match input {
        Input::Missing => None,
        other => Some(other.value().map(|items| sqlx::types::Json(json!(items)))),
    });
    let is_first_year = data.is_first_year.clone().and_then(|input| match input {
        Input::Missing => None,
        other => Some(other.value()),
    });
    if full_name.is_some() {
        assignments.push(next("full_name"));
    }
    if avatar_url.is_some() {
        assignments.push(next("avatar_url"));
    }
    if faculty.is_some() || clear_faculty {
        assignments.push(next("faculty"));
    }
    if interests.is_some() {
        assignments.push(next("interests"));
    }
    if is_first_year.is_some() {
        assignments.push(next("is_first_year"));
    }
    if school.is_some() {
        assignments.push(next("school_id"));
    }
    let sql = format!(
        "UPDATE public.users SET {} WHERE id = $1 RETURNING {}, NULL::text AS school",
        assignments.join(", "),
        user_columns("users")
    );
    let mut query = sqlx::query(&sql).bind(user_id);
    if let Some(value) = full_name {
        query = query.bind(value);
    }
    if let Some(value) = avatar_url {
        query = query.bind(value);
    }
    if faculty.is_some() || clear_faculty {
        query = query.bind(faculty.flatten());
    }
    if let Some(value) = interests {
        query = query.bind(value);
    }
    if let Some(value) = is_first_year {
        query = query.bind(value);
    }
    if let Some((school_id, _)) = &school {
        query = query.bind(school_id);
    }
    let Some(row) = query.fetch_optional(db).await? else {
        return Ok(None);
    };
    let mut user = UserResponse::from_row(&row)?;
    // Python echoes the school as sent (not normalized), else the stored one.
    user.school = school_input
        .value()
        .filter(|school| !school.is_empty())
        .or(existing.school);
    Ok(Some(user))
}

#[utoipa::path(
    patch,
    path = "/users/me",
    tag = "users",
    operation_id = "update_me_users_me_patch",
    summary = "Update Me",
    request_body = UserUpdateBody,
    responses(
        (status = 200, description = "Successful Response", body = UserResponse),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn update_me(
    State(state): State<AppState>,
    DbUser(user): DbUser,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<Response, ApiError> {
    let data = UserUpdate::parse(Body::parse(&bytes, &headers, Extra::Forbid)?, true)?;
    nullable_user(update_user(&state.db, user.id, data).await?)
}

#[utoipa::path(
    patch,
    path = "/users/me/profile",
    tag = "users",
    operation_id = "update_profile_users_me_profile_patch",
    summary = "Update Profile",
    request_body = UserProfileUpdate,
    responses(
        (status = 200, description = "Successful Response", body = UserResponse),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn update_profile(
    State(state): State<AppState>,
    DbUser(user): DbUser,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<Response, ApiError> {
    let data = UserUpdate::parse(Body::parse(&bytes, &headers, Extra::Forbid)?, false)?;
    nullable_user(update_user(&state.db, user.id, data).await?)
}

/// A route returning `None` with `response_model=UserResponse` fails
/// FastAPI's response validation (the user vanished mid-request).
fn nullable_user(user: Option<UserResponse>) -> Result<Response, ApiError> {
    match user {
        Some(user) => Ok(Json(user).into_response()),
        None => Err(ApiError::Internal(anyhow::anyhow!(
            "the updated user no longer exists"
        ))),
    }
}

/// `PayoutEmail`: an `EmailStr` that cannot start a spreadsheet formula.
fn payout_email(body: &mut Body) -> Option<String> {
    match body.email("payout_email") {
        Input::Given(email) => {
            if email.starts_with(['=', '+', '-', '@', '\t', '\r', '\n']) {
                body.field_error(
                    "payout_email",
                    json!(email),
                    "payout email cannot begin with a spreadsheet formula character",
                );
                return None;
            }
            Some(email)
        }
        Input::Null => {
            body.required_string("payout_email", &Str::new());
            None
        }
        Input::Missing => {
            body.missing("payout_email");
            None
        }
    }
}

#[utoipa::path(
    put,
    path = "/users/me/promoter-enrollment",
    tag = "users",
    operation_id = "update_promoter_enrollment_users_me_promoter_enrollment_put",
    summary = "Update Promoter Enrollment",
    request_body = PromoterEnrollmentUpdate,
    responses(
        (status = 200, description = "Successful Response", body = UserResponse),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn update_promoter_enrollment(
    State(state): State<AppState>,
    DbUser(user): DbUser,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<Json<UserResponse>, ApiError> {
    let mut body = Body::parse(&bytes, &headers, Extra::Forbid)?;
    let email = payout_email(&mut body);
    let accept_tos = body.bool("accept_tos").value().unwrap_or(false);
    body.finish()?;
    let email = email.unwrap_or_default();
    let existing = get_or_404(get_user(&state.db, user.id).await?, USER_NOT_FOUND)?;
    let enrolled = existing.payout_email.is_some()
        && existing.promoter_tos_accepted_at.is_some()
        && existing.promoter_tos_version.is_some();
    if !enrolled {
        let slug = normalize_slug(existing.school.as_deref().unwrap_or_default());
        if school_by_slug(&state.db, &slug).await?.is_none() {
            return Err(ApiError::validation(PROMOTER_SCHOOL_REQUIRED));
        }
        if !PROMOTER_PROGRAM.enabled {
            return Err(ApiError::validation(PROMOTER_PROGRAM_PAUSED));
        }
        if !accept_tos {
            return Err(ApiError::validation(PROMOTER_TOS_REQUIRED));
        }
    }
    // Acceptance is server-owned and stamped only when enrolling.
    let sql = format!(
        "UPDATE public.users SET payout_email = $2{} WHERE id = $1 RETURNING {}, NULL::text AS school",
        if enrolled {
            ""
        } else {
            ", promoter_tos_accepted_at = $3, promoter_tos_version = $4"
        },
        user_columns("users")
    );
    let mut query = sqlx::query(&sql).bind(user.id).bind(&email);
    if !enrolled {
        query = query.bind(Utc::now()).bind(&PROMOTER_PROGRAM.tos_version);
    }
    let row = query.fetch_optional(&state.db).await?;
    let row = get_or_404(row, USER_NOT_FOUND)?;
    let mut updated = UserResponse::from_row(&row)?;
    updated.school = existing.school;
    Ok(Json(updated))
}

#[utoipa::path(
    get,
    path = "/users/",
    tag = "users",
    operation_id = "list_users_users__get",
    summary = "List Users",
    params(
        ("skip" = Option<i64>, Query, minimum = 0),
        ("limit" = Option<i64>, Query, minimum = 1, maximum = 100000),
    ),
    responses(
        (status = 200, description = "Successful Response", body = Vec<UserResponse>),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn list_users(
    State(state): State<AppState>,
    AdminUser(_): AdminUser,
    query: QueryParams,
) -> Result<Json<Vec<UserResponse>>, ApiError> {
    let mut check = Validator::default();
    let skip = check.query(&query, "skip").int_or(0, Limits::default().ge(0));
    let limit = check
        .query(&query, "limit")
        .int_or(MAX_LIST_LIMIT, Limits::default().ge(1).le(MAX_LIST_LIMIT));
    check.finish()?;
    // PostgREST answered at most 1000 rows whatever the range asked for.
    let limit = limit.min(1000);
    let sql = format!(
        "{} ORDER BY u.created_at DESC LIMIT $1 OFFSET $2",
        user_query("true")
    );
    let users = read_with_retry(|| {
        sqlx::query_as::<_, UserResponse>(&sql)
            .bind(limit)
            .bind(skip)
            .fetch_all(&state.db)
    })
    .await?;
    Ok(Json(users))
}

fn user_id(path: &PathParams) -> Result<Uuid, ApiError> {
    let mut check = Validator::default();
    let id = check.path(path, "user_id").uuid();
    check.finish()?;
    Ok(id)
}

#[utoipa::path(
    get,
    path = "/users/{user_id}",
    tag = "users",
    operation_id = "get_user_users__user_id__get",
    summary = "Get User",
    params(("user_id" = String, Path, format = Uuid)),
    responses(
        (status = 200, description = "Successful Response", body = UserResponse),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn get_user_route(
    State(state): State<AppState>,
    AdminUser(_): AdminUser,
    path: PathParams,
) -> Result<Json<UserResponse>, ApiError> {
    let id = user_id(&path)?;
    Ok(Json(get_or_404(get_user(&state.db, id).await?, USER_NOT_FOUND)?))
}

/// Whether removing `target`'s admin role would leave no admin.
async fn is_last_admin(db: &sqlx::PgPool, target: Uuid) -> Result<bool, ApiError> {
    Ok(read_with_retry(|| {
        sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS (SELECT 1 FROM public.users WHERE id = $1 AND role = $2) \
             AND (SELECT count(*) FROM public.users WHERE role = $2) <= 1",
        )
        .bind(target)
        .bind(ROLE_ADMIN)
        .fetch_one(db)
    })
    .await?)
}

#[utoipa::path(
    patch,
    path = "/users/{user_id}/role",
    tag = "users",
    operation_id = "update_user_role_users__user_id__role_patch",
    summary = "Update User Role",
    description = "Admin-only: rotate a user's role ('user' <-> 'admin').\n\nSeparate from ``PATCH /users/{id}`` so role is only mutable through an\nexplicitly-admin endpoint - keeps the trust boundary bright.\nIf the target is currently an admin and the new role is not ``admin``,\nrefuse the demotion when it would leave zero admins.",
    params(("user_id" = String, Path, format = Uuid)),
    request_body = UserRoleUpdate,
    responses(
        (status = 200, description = "Successful Response", body = UserResponse),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn update_user_role(
    State(state): State<AppState>,
    AdminUser(_): AdminUser,
    path: PathParams,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<Json<UserResponse>, ApiError> {
    let mut check = Validator::default();
    let id = check.path(&path, "user_id").uuid();
    // Path and body problems are reported together, as FastAPI does.
    let body = Body::parse(&bytes, &headers, Extra::Forbid);
    let (role, body_result) = match body {
        Ok(mut body) => {
            let role = body.required_string("role", &Str::new().one_of(ROLES));
            (role, body.finish())
        }
        Err(error) => (None, Err(error)),
    };
    merge_issues(check, body_result)?;
    let role = role.unwrap_or_default();
    if role != ROLE_ADMIN && is_last_admin(&state.db, id).await? {
        return Err(ApiError::validation(LAST_ADMIN_REQUIRED));
    }
    let updated = sqlx::query_scalar::<_, bool>(
        "WITH updated AS (UPDATE public.users SET role = $2 WHERE id = $1 RETURNING 1) \
         SELECT EXISTS (SELECT 1 FROM updated)",
    )
    .bind(id)
    .bind(&role)
    .fetch_one(&state.db)
    .await?;
    let user = if updated {
        get_user(&state.db, id).await?
    } else {
        None
    };
    Ok(Json(get_or_404(user, USER_NOT_FOUND)?))
}

#[utoipa::path(
    delete,
    path = "/users/{user_id}",
    tag = "users",
    operation_id = "delete_user_users__user_id__delete",
    summary = "Delete User",
    description = "Admin-only user deletion with quorum guardrails.\n\n- **Self-delete block:** admins cannot delete their own account here.\n  Account deletion for the caller must use an explicit \"delete my\n  account\" flow (not implemented here).\n- **Admin quorum:** if the target is an admin, refuse when the system\n  would end up with zero admins.",
    params(("user_id" = String, Path, format = Uuid)),
    responses(
        (status = 204, description = "Successful Response"),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn delete_user(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    path: PathParams,
) -> Result<Response, ApiError> {
    let id = user_id(&path)?;
    if admin.id == id {
        return Err(ApiError::authorization(CANNOT_DELETE_SELF));
    }
    if is_last_admin(&state.db, id).await? {
        return Err(ApiError::validation(LAST_ADMIN_REQUIRED));
    }
    // Financial and promoter records keep their user; refuse rather than orphan them.
    let (payouts, posters, reviews) = read_with_retry(|| {
        sqlx::query_as::<_, (bool, bool, bool)>(
            "SELECT EXISTS (SELECT 1 FROM public.poster_payouts WHERE user_id = $1), \
             EXISTS (SELECT 1 FROM public.qr_codes WHERE created_by = $1 AND program = 'promoter'), \
             EXISTS (SELECT 1 FROM public.poster_payout_reviews WHERE reviewed_by = $1)",
        )
        .bind(id)
        .fetch_one(&state.db)
    })
    .await?;
    if payouts {
        return Err(ApiError::validation(USER_HAS_PAYOUTS));
    }
    if posters {
        return Err(ApiError::validation(USER_HAS_PROMOTER_POSTERS));
    }
    if reviews {
        return Err(ApiError::validation(USER_HAS_PAYOUT_REVIEWS));
    }
    let deleted = sqlx::query("DELETE FROM public.users WHERE id = $1")
        .bind(id)
        .execute(&state.db)
        .await?
        .rows_affected();
    if deleted == 0 {
        return Err(ApiError::not_found(USER_NOT_FOUND));
    }
    Ok(no_content())
}

/// FastAPI's empty 204 for a route that returns nothing (it keeps the JSON
/// content type).
pub fn no_content() -> Response {
    let mut response = StatusCode::NO_CONTENT.into_response();
    response.headers_mut().insert(
        axum::http::header::CONTENT_TYPE,
        axum::http::HeaderValue::from_static("application/json"),
    );
    response
}

/// Request bodies, documented for the OpenAPI schema.
#[allow(dead_code)]
#[derive(ToSchema)]
#[schema(as = UserUpdate)]
pub struct UserUpdateBody {
    #[schema(max_length = 255)]
    full_name: Option<String>,
    #[schema(max_length = 2048)]
    avatar_url: Option<String>,
    #[schema(max_length = 255)]
    faculty: Option<String>,
    #[schema(max_length = 255)]
    school: Option<String>,
    #[schema(max_items = 50)]
    interests: Option<Vec<String>>,
    is_first_year: Option<bool>,
}

#[allow(dead_code)]
#[derive(ToSchema)]
pub struct UserProfileUpdate {
    #[schema(max_length = 255)]
    faculty: Option<String>,
    #[schema(max_length = 255)]
    school: Option<String>,
    #[schema(max_items = 50)]
    interests: Option<Vec<String>>,
    is_first_year: Option<bool>,
}

/// Admin-only payload for rotating a user's role.
#[allow(dead_code)]
#[derive(ToSchema)]
pub struct UserRoleUpdate {
    #[schema(inline)]
    role: UserRole,
}

#[allow(dead_code)]
#[derive(ToSchema)]
pub struct PromoterEnrollmentUpdate {
    #[schema(format = Email)]
    payout_email: String,
    #[schema(default = false)]
    accept_tos: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identicons_match_python() {
        // services.user_service.avatar_url_for_user("00000000-0000-0000-0000-000000000001")
        assert_eq!(
            avatar_url_for_user("00000000-0000-0000-0000-000000000001", None),
            "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48cmVjdCB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgZmlsbD0iI2YxZjVmOSIvPjxwYXRoIGZpbGw9ImhzbCgxMDUgNTUlIDQyJSkiIGQ9Ik0yNiAxMGgxNnYxNmgtMTZ6TTU4IDEwaDE2djE2aC0xNnpNNDIgMTBoMTZ2MTZoLTE2ek0xMCAyNmgxNnYxNmgtMTZ6TTc0IDI2aDE2djE2aC0xNnpNNDIgMjZoMTZ2MTZoLTE2ek0xMCA1OGgxNnYxNmgtMTZ6TTc0IDU4aDE2djE2aC0xNnpNMjYgNThoMTZ2MTZoLTE2ek01OCA1OGgxNnYxNmgtMTZ6TTQyIDU4aDE2djE2aC0xNnoiLz48L3N2Zz4="
        );
    }

    #[test]
    fn default_avatar_is_stable_distinct_and_preserves_uploaded_photo() {
        let first = avatar_url_for_user("first-user", None);
        assert!(first.starts_with("data:image/svg+xml;base64,"));
        assert_eq!(first, avatar_url_for_user("first-user", Some("")));
        assert_ne!(first, avatar_url_for_user("second-user", None));
        assert_eq!(
            avatar_url_for_user("first-user", Some("https://example.com/photo.jpg")),
            "https://example.com/photo.jpg"
        );
        for seed in 0..1000 {
            assert!(avatar_url_for_user(&seed.to_string(), None).len() <= MAX_AVATAR_URL_LENGTH);
        }
    }

    #[test]
    fn profile_bodies_are_validated_like_pydantic() {
        let parse = |value: Value, full: bool| UserUpdate::parse(Body::from_value(value, Extra::Forbid), full);
        let update = parse(json!({"faculty": "Math", "is_first_year": "yes", "interests": ["a"]}), true).unwrap();
        assert_eq!(update.is_first_year, Some(Input::Given(true)));
        assert_eq!(update.full_name, Some(Input::Missing));
        // The profile form cannot change the name.
        assert!(parse(json!({"full_name": "x"}), false).is_err());
        assert!(parse(json!({"interests": vec!["a"; 51]}), true).is_err());
        assert!(parse(json!({"is_first_year": 2}), true).is_err());
    }

    #[test]
    fn payout_emails_refuse_formulas_and_bad_addresses() {
        // test_promoter_enrollment_rejects_csv_formula_email / _invalid_email
        for (payload, expected) in [
            (json!({"payout_email": "=a@b.com"}), "Value error, payout email cannot begin with a spreadsheet formula character"),
            (json!({"payout_email": "not-an-email"}), "value is not a valid email address: An email address must have an @-sign."),
        ] {
            let mut body = Body::from_value(payload, Extra::Forbid);
            assert_eq!(payout_email(&mut body), None);
            match body.finish() {
                Err(ApiError::RequestValidation(issues)) => assert_eq!(issues[0].msg, expected),
                other => panic!("{other:?}"),
            }
        }
        let mut body = Body::from_value(json!({"payout_email": "Pay@Example.COM"}), Extra::Forbid);
        assert_eq!(payout_email(&mut body).as_deref(), Some("Pay@example.com"));
    }
}
