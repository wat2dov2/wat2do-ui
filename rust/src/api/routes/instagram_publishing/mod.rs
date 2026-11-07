//! `/instagram-publishing`: the admin's carousel editor, song list, account
//! dashboard and follow review (`routers/instagram_publishing.py`).
//!
//! Every route is admin-only. Publishing claims the batch here and hands the
//! rendering and posting to `wat2do-instagram publish-batch`
//! (`batches::publish_in_background`), the code the scheduled publish runs.

pub mod accounts;
pub mod batches;
pub mod captions;
pub mod credentials;
pub mod follow_candidates;
pub mod songs;

use std::sync::LazyLock;

use axum::Json;
use axum::extract::{FromRequestParts, Request, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use regex::Regex;

use crate::api::AppState;
use crate::api::auth::AdminUser;
use crate::api::body::{Body, Extra, Input, Str, json_first, merge_issues};
use crate::api::errors::ApiError;
use crate::api::pagination::{Paginated, Pagination};
use crate::api::routes::users::no_content;
use crate::api::validation::{Length, Limits, PathParams, QueryParams, Validator};
use crate::controlbox::INSTAGRAM_PUBLISHING;

/// `InstagramPublishBatchUpdate.caption_intro`'s limit (Instagram's caption length).
const CAPTION_INTRO_MAX_LENGTH: usize = 2200;
const SONG_QUERY_MAX_LENGTH: usize = 200;
const MAX_DECISIONS: usize = 500;
static NOT_BLANK: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\S").expect("pattern"));

// ── Request bodies ──────────────────────────────────────────────────────────

/// A string field with a default (not `Optional`): missing reads as empty,
/// and `null` is refused.
fn string_or_empty(body: &mut Body, name: &'static str, rules: &Str) -> String {
    match body.string(name, rules) {
        Input::Given(text) => text,
        Input::Null => {
            body.type_error(name, "string_type", "Input should be a valid string");
            String::new()
        }
        Input::Missing => String::new(),
    }
}

/// `InstagramPublishBatchUpdate`.
fn parse_draft_update(mut body: Body) -> Result<batches::DraftUpdate, ApiError> {
    let version = body.required_int("version", Limits::default().gt(0));
    let caption_intro = string_or_empty(
        &mut body,
        "caption_intro",
        &Str::new().max(CAPTION_INTRO_MAX_LENGTH),
    );
    let cover_body = string_or_empty(
        &mut body,
        "cover_body",
        &Str::new().max(INSTAGRAM_PUBLISHING.cover_body_character_limit),
    );
    if !body.has_field("event_ids") {
        body.missing("event_ids");
    }
    let event_ids = body.list("event_ids", 1, usize::MAX, |body, loc, value| {
        body.int_item(loc, value)
    });
    if let Input::Null = event_ids {
        body.type_error("event_ids", "list_type", "Input should be a valid list");
    }
    body.finish()?;
    Ok(batches::DraftUpdate {
        version: version.unwrap_or_default(),
        caption_intro,
        cover_body,
        event_ids: event_ids.value().unwrap_or_default(),
    })
}

/// `InstagramPublishBatchPublish`: the version the admin saw.
fn parse_publish(mut body: Body) -> Result<i64, ApiError> {
    let version = body.required_int("version", Limits::default().gt(0));
    body.finish()?;
    Ok(version.unwrap_or_default())
}

/// `InstagramSongCreate`.
fn parse_song(mut body: Body) -> Result<(String, bool), ApiError> {
    let query = body.required_string(
        "query",
        &Str::new()
            .min(1)
            .max(SONG_QUERY_MAX_LENGTH)
            .pattern(r"\S", &NOT_BLANK),
    );
    let asian_campuses_only = body.bool_or("asian_campuses_only", false);
    body.finish()?;
    Ok((query.unwrap_or_default(), asian_campuses_only))
}

/// `FollowCandidateDecisionsSubmit`: 1 to 500 `{id, status}` decisions.
fn parse_decisions(mut body: Body) -> Result<Vec<(uuid::Uuid, String)>, ApiError> {
    if !body.has_field("decisions") {
        body.missing("decisions");
    }
    let decisions = body.list("decisions", 1, MAX_DECISIONS, |body, loc, value| {
        // `FollowCandidateDecision` ignores unknown keys.
        body.nested_item(loc, value, Extra::Ignore, |item| {
            let id = item.required_uuid("id");
            let status =
                item.required_string("status", &Str::new().one_of(follow_candidates::DECISIONS));
            Some((id?, status?))
        })
    });
    if let Input::Null = decisions {
        body.type_error("decisions", "list_type", "Input should be a valid list");
    }
    body.finish()?;
    Ok(decisions.value().unwrap_or_default())
}

/// Admin first, then the path and body problems in one 422, as FastAPI
/// resolves a route with a body; malformed JSON is refused before either.
async fn admin_path_body<T>(
    state: &AppState,
    request: Request,
    path_name: &str,
    parse: impl FnOnce(Body) -> Result<T, ApiError>,
) -> Result<(uuid::Uuid, T), ApiError> {
    let (mut parts, bytes) = json_first(request).await?;
    AdminUser::from_request_parts(&mut parts, state).await?;
    let path = PathParams::from_request_parts(&mut parts, state).await?;
    let mut check = Validator::default();
    let id = check.path(&path, path_name).uuid();
    let value = merge_issues(
        check,
        Body::parse(&bytes, &parts.headers, Extra::Forbid).and_then(parse),
    )?;
    Ok((id, value))
}

/// Admin first, then the body.
async fn admin_body<T>(
    state: &AppState,
    request: Request,
    parse: impl FnOnce(Body) -> Result<T, ApiError>,
) -> Result<(crate::api::auth::User, T), ApiError> {
    let (mut parts, bytes) = json_first(request).await?;
    let AdminUser(admin) = AdminUser::from_request_parts(&mut parts, state).await?;
    let value = parse(Body::parse(&bytes, &parts.headers, Extra::Forbid)?)?;
    Ok((admin, value))
}

// ── Batches ─────────────────────────────────────────────────────────────────

#[utoipa::path(
    get,
    path = "/instagram-publishing/batches/",
    tag = "instagram-publishing",
    operation_id = "list_instagram_publish_batches_instagram_publishing_batches__get",
    summary = "List Instagram Publish Batches"
)]
pub async fn list_instagram_publish_batches(
    State(state): State<AppState>,
    AdminUser(_): AdminUser,
    query: QueryParams,
) -> Result<Response, ApiError> {
    let mut check = Validator::default();
    // FastAPI reports the pagination dependency's problems first.
    let pagination = Pagination::read(&mut check, &query);
    let status = check
        .query(&query, "status")
        .optional_choice(batches::STATUSES);
    let local_date = check.query(&query, "local_date").optional_date();
    check.finish()?;
    let (items, total) =
        batches::list_batches(&state.db, status.as_deref(), local_date, pagination).await?;
    Ok(Json(Paginated::new(items, total, pagination)).into_response())
}

#[utoipa::path(
    get,
    path = "/instagram-publishing/batches/{batch_id}",
    tag = "instagram-publishing",
    operation_id = "get_instagram_publish_batch_instagram_publishing_batches__batch_id__get",
    summary = "Get Instagram Publish Batch"
)]
pub async fn get_instagram_publish_batch(
    State(state): State<AppState>,
    AdminUser(_): AdminUser,
    path: PathParams,
) -> Result<Response, ApiError> {
    let mut check = Validator::default();
    let batch_id = check.path(&path, "batch_id").uuid();
    check.finish()?;
    Ok(Json(batches::get_batch(&state.db, batch_id).await?).into_response())
}

#[utoipa::path(
    patch,
    path = "/instagram-publishing/batches/{batch_id}",
    tag = "instagram-publishing",
    operation_id = "update_instagram_publish_batch_instagram_publishing_batches__batch_id__patch",
    summary = "Update Instagram Publish Batch"
)]
pub async fn update_instagram_publish_batch(
    State(state): State<AppState>,
    request: Request,
) -> Result<Response, ApiError> {
    let (batch_id, update) =
        admin_path_body(&state, request, "batch_id", parse_draft_update).await?;
    Ok(Json(batches::update_batch(&state.db, batch_id, update).await?).into_response())
}

#[utoipa::path(
    post,
    path = "/instagram-publishing/batches/{batch_id}/publish",
    tag = "instagram-publishing",
    operation_id = "publish_instagram_batch_instagram_publishing_batches__batch_id__publish_post",
    summary = "Publish Instagram Batch"
)]
pub async fn publish_instagram_batch(
    State(state): State<AppState>,
    request: Request,
) -> Result<Response, ApiError> {
    let (batch_id, version) = admin_path_body(&state, request, "batch_id", parse_publish).await?;
    let batch = batches::claim_batch(
        &state.db,
        &state.settings.instagram_token_encryption_key,
        batch_id,
        version,
    )
    .await?;
    batches::publish_in_background(state.db.clone(), batch_id);
    Ok((StatusCode::ACCEPTED, Json(batch)).into_response())
}

// ── Songs ───────────────────────────────────────────────────────────────────

#[utoipa::path(
    get,
    path = "/instagram-publishing/songs/",
    tag = "instagram-publishing",
    operation_id = "list_instagram_songs_instagram_publishing_songs__get",
    summary = "List Instagram Songs"
)]
pub async fn list_instagram_songs(
    State(state): State<AppState>,
    AdminUser(_): AdminUser,
) -> Result<Response, ApiError> {
    Ok(Json(songs::list(&state.db).await?).into_response())
}

#[utoipa::path(
    post,
    path = "/instagram-publishing/songs/",
    tag = "instagram-publishing",
    operation_id = "add_instagram_song_instagram_publishing_songs__post",
    summary = "Add Instagram Song"
)]
pub async fn add_instagram_song(
    State(state): State<AppState>,
    request: Request,
) -> Result<Response, ApiError> {
    let (_, (query, asian_campuses_only)) = admin_body(&state, request, parse_song).await?;
    let song = songs::add(&state.db, &query, asian_campuses_only).await?;
    Ok((StatusCode::CREATED, Json(song)).into_response())
}

#[utoipa::path(
    delete,
    path = "/instagram-publishing/songs/{song_id}",
    tag = "instagram-publishing",
    operation_id = "delete_instagram_song_instagram_publishing_songs__song_id__delete",
    summary = "Delete Instagram Song"
)]
pub async fn delete_instagram_song(
    State(state): State<AppState>,
    AdminUser(_): AdminUser,
    path: PathParams,
) -> Result<Response, ApiError> {
    let mut check = Validator::default();
    let song_id = check.path(&path, "song_id").uuid();
    check.finish()?;
    songs::delete(&state.db, song_id).await?;
    Ok(no_content())
}

// ── Accounts and follows ────────────────────────────────────────────────────

#[utoipa::path(
    get,
    path = "/instagram-publishing/accounts/",
    tag = "instagram-publishing",
    operation_id = "list_instagram_account_stats_instagram_publishing_accounts__get",
    summary = "List Instagram Account Stats"
)]
pub async fn list_instagram_account_stats(
    State(state): State<AppState>,
    AdminUser(_): AdminUser,
) -> Result<Response, ApiError> {
    Ok(Json(accounts::list(&state.db).await?).into_response())
}

#[utoipa::path(
    get,
    path = "/instagram-publishing/follow-candidates/",
    tag = "instagram-publishing",
    operation_id = "list_follow_candidates_instagram_publishing_follow_candidates__get",
    summary = "List Follow Candidates"
)]
pub async fn list_follow_candidates(
    State(state): State<AppState>,
    AdminUser(_): AdminUser,
    query: QueryParams,
) -> Result<Response, ApiError> {
    let mut check = Validator::default();
    let pagination = Pagination::read(&mut check, &query);
    let status = check
        .query(&query, "status")
        .choice_or("pending", follow_candidates::STATUSES);
    let school = check
        .query(&query, "school")
        .optional_string(Length::default());
    check.finish()?;
    let (items, total) =
        follow_candidates::list(&state.db, school.as_deref(), &status, pagination).await?;
    Ok(Json(Paginated::new(items, total, pagination)).into_response())
}

#[utoipa::path(
    post,
    path = "/instagram-publishing/follow-candidates/decisions",
    tag = "instagram-publishing",
    operation_id = "submit_follow_decisions_instagram_publishing_follow_candidates_decisions_post",
    summary = "Submit Follow Decisions"
)]
pub async fn submit_follow_decisions(
    State(state): State<AppState>,
    request: Request,
) -> Result<Response, ApiError> {
    let (admin, decisions) = admin_body(&state, request, parse_decisions).await?;
    let counts = follow_candidates::decide(&state.db, &decisions, admin.id).await?;
    Ok(Json(counts).into_response())
}

#[cfg(test)]
mod database_tests;
#[cfg(test)]
mod tests;
