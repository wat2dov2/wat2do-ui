//! `/notifications`: the signed-in user's notification inbox, under the bell in
//! the top bar. Each notification repeats an email the user was sent
//! (`crate::notifications::inbox` records them).

use axum::Json;
use axum::body::Bytes;
use axum::extract::{FromRequestParts, Request, State};
use axum::http::HeaderMap;
use axum::response::Response;
use chrono::{DateTime, Utc};
use serde::Serialize;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::api::AppState;
use crate::api::auth::DbUser;
use crate::api::body::{Body, Extra, json_first};
use crate::api::errors::ApiError;
use crate::api::json;
use crate::api::routes::events::no_content;
use crate::controlbox::NOTIFICATION_INBOX;
use crate::notifications::inbox::{
    self, Inbox, Notification, NotificationDetails, NotificationKind,
};

/// One notification as the bell's list shows it.
#[derive(Debug, Serialize, ToSchema)]
pub struct NotificationResponse {
    pub id: Uuid,
    pub kind: NotificationKind,
    pub details: NotificationDetails,
    /// Where it leads: the page its email linked to, on the right school's site.
    #[schema(required = true)]
    pub link: Option<String>,
    #[serde(serialize_with = "json::datetime")]
    #[schema(value_type = String, format = DateTime)]
    pub created_at: DateTime<Utc>,
    pub read: bool,
}

/// The user's newest notifications, and how many of them are still unread.
#[derive(Debug, Serialize, ToSchema)]
pub struct NotificationInboxResponse {
    pub unread_count: i64,
    pub notifications: Vec<NotificationResponse>,
}

impl From<Notification> for NotificationResponse {
    fn from(notification: Notification) -> Self {
        Self {
            id: notification.id,
            kind: notification.kind,
            details: notification.details,
            link: notification.link,
            created_at: notification.created_at,
            read: notification.read,
        }
    }
}

impl From<Inbox> for NotificationInboxResponse {
    fn from(inbox: Inbox) -> Self {
        Self {
            unread_count: inbox.unread_count,
            notifications: inbox.notifications.into_iter().map(Into::into).collect(),
        }
    }
}

#[utoipa::path(
    get,
    path = "/notifications/",
    tag = "notifications",
    operation_id = "list_my_notifications_notifications__get",
    summary = "List My Notifications",
    description = "The user's newest notifications, newest first, with how many are unread.",
    responses((status = 200, description = "Successful Response", body = NotificationInboxResponse))
)]
pub async fn list_my_notifications(
    State(state): State<AppState>,
    DbUser(user): DbUser,
) -> Result<Json<NotificationInboxResponse>, ApiError> {
    Ok(Json(inbox::inbox(&state.db, user.id).await?.into()))
}

/// The notifications a visitor's open list showed, to mark read.
#[allow(dead_code)]
#[derive(ToSchema)]
pub struct NotificationReadRequest {
    #[schema(value_type = Vec<String>, format = Uuid, min_items = 1, max_items = 100)]
    notification_ids: Vec<Uuid>,
}

/// `NotificationReadRequest`: the ids the list showed, at most a page of them.
fn read_ids(bytes: &Bytes, headers: &HeaderMap) -> Result<Vec<Uuid>, ApiError> {
    let mut body = Body::parse(bytes, headers, Extra::Forbid)?;
    let page = usize::try_from(NOTIFICATION_INBOX.page_size).unwrap_or(1);
    let ids = body.required_uuid_list("notification_ids", 1, page);
    body.finish()?;
    Ok(ids.unwrap_or_default())
}

#[utoipa::path(
    post,
    path = "/notifications/read",
    tag = "notifications",
    operation_id = "mark_my_notifications_read_notifications_read_post",
    summary = "Mark My Notifications Read",
    description = "Mark read the user's notifications among those their list showed; any that arrived since stay unread.",
    request_body = NotificationReadRequest,
    responses(
        (status = 204, description = "Successful Response"),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn mark_my_notifications_read(
    State(state): State<AppState>,
    request: Request,
) -> Result<Response, ApiError> {
    let (mut parts, bytes) = json_first(request).await?;
    let DbUser(user) = DbUser::from_request_parts(&mut parts, &state).await?;
    let ids = read_ids(&bytes, &parts.headers)?;
    inbox::mark_read(&state.db, user.id, &ids).await?;
    Ok(no_content())
}
