//! `/notification-preferences`: the signed-in user's email toggles and the
//! one-click unsubscribe pages linked from every email
//! (`routers/notification_preferences.py`, `services/notifications/preferences.py`).
//!
//! A type the user never chose resolves to its default
//! (`controlbox/notification_defaults.json`) with `updated_at` null, so the
//! settings page can tell a default from a choice. Every choice is recorded
//! with its consent evidence by `set_notification_preferences`.

use axum::Json;
use axum::extract::{FromRequestParts, Request, State};
use axum::http::header;
use axum::response::{IntoResponse, Response};
use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

use crate::api::AppState;
use crate::api::auth::DbUser;
use crate::api::body::{Body, Extra, Input, Str, json_first};
use crate::api::errors::ApiError;
use crate::api::json;
use crate::api::routes::users::no_content;
use crate::api::validation::{Length, QueryParams, Validator};
use crate::constants::NOTIFICATION_TYPES;
use crate::controlbox::{EMAIL_DELIVERY, NOTIFICATION_DEFAULTS};
use crate::db::read_with_retry;
use crate::notifications::unsubscribe;

/// `NotificationPreferenceResponse`.
#[derive(Debug, Serialize, PartialEq)]
pub struct NotificationPreferenceResponse {
    pub notification_type: &'static str,
    pub enabled: bool,
    #[serde(serialize_with = "json::option_datetime")]
    pub updated_at: Option<DateTime<Utc>>,
}

/// `NotificationPreferencesListResponse`.
#[derive(Debug, Serialize)]
pub struct NotificationPreferencesListResponse {
    pub preferences: Vec<NotificationPreferenceResponse>,
}

/// One entry per type, in `NOTIFICATION_TYPES` order; rows of retired types are ignored.
fn resolve(rows: &[(String, bool, DateTime<Utc>)]) -> Vec<NotificationPreferenceResponse> {
    NOTIFICATION_TYPES
        .into_iter()
        .map(
            |notification_type| match rows.iter().find(|(kind, _, _)| kind == notification_type) {
                Some((_, enabled, updated_at)) => NotificationPreferenceResponse {
                    notification_type,
                    enabled: *enabled,
                    updated_at: Some(*updated_at),
                },
                None => NotificationPreferenceResponse {
                    notification_type,
                    enabled: NOTIFICATION_DEFAULTS.enabled(notification_type),
                    updated_at: None,
                },
            },
        )
        .collect()
}

#[utoipa::path(
    get,
    path = "/notification-preferences",
    tag = "notifications",
    operation_id = "get_my_preferences_notification_preferences_get",
    summary = "Get My Preferences"
)]
pub async fn get_my_preferences(
    State(state): State<AppState>,
    DbUser(user): DbUser,
) -> Result<Json<NotificationPreferencesListResponse>, ApiError> {
    Ok(Json(NotificationPreferencesListResponse {
        preferences: preferences(&state.db, user.id).await?,
    }))
}

/// `get_preferences`: one resolved entry per type.
async fn preferences(
    db: &PgPool,
    user_id: Uuid,
) -> Result<Vec<NotificationPreferenceResponse>, ApiError> {
    let rows: Vec<(String, bool, DateTime<Utc>)> = read_with_retry(|| {
        sqlx::query_as(
            "SELECT notification_type, enabled, updated_at FROM public.notification_preferences \
             WHERE user_id = $1",
        )
        .bind(user_id)
        .fetch_all(db)
    })
    .await?;
    Ok(resolve(&rows))
}

/// `NotificationPreferencesBulkUpdate`: 1 to 32 `{notification_type, enabled}` choices.
fn parse_updates(mut body: Body) -> Result<Vec<(String, bool)>, ApiError> {
    if !body.has_field("preferences") {
        body.missing("preferences");
    }
    let updates = body.list("preferences", 1, 32, |body, loc, value| {
        body.nested_item(loc, value, Extra::Forbid, |item| {
            let notification_type =
                item.required_string("notification_type", &Str::new().one_of(&NOTIFICATION_TYPES));
            let enabled = item.required_bool("enabled");
            Some((notification_type?, enabled?))
        })
    });
    if let Input::Null = updates {
        body.type_error("preferences", "list_type", "Input should be a valid list");
    }
    body.finish()?;
    Ok(updates.value().unwrap_or_default())
}

/// `set_preferences`: every choice and its consent evidence in one transaction.
async fn set_preferences(
    db: &PgPool,
    user_id: Uuid,
    updates: &[(String, bool)],
    source: &str,
) -> Result<(), ApiError> {
    let updates: Vec<Value> = updates
        .iter()
        .map(|(notification_type, enabled)| {
            json!({"notification_type": notification_type, "enabled": enabled})
        })
        .collect();
    sqlx::query("SELECT public.set_notification_preferences($1, $2, $3, $4)")
        .bind(user_id)
        .bind(Value::Array(updates))
        .bind(source)
        .bind(&EMAIL_DELIVERY.notification_consent_version)
        .execute(db)
        .await?;
    Ok(())
}

#[utoipa::path(
    patch,
    path = "/notification-preferences",
    tag = "notifications",
    operation_id = "update_my_preferences_notification_preferences_patch",
    summary = "Update My Preferences"
)]
pub async fn update_my_preferences(
    State(state): State<AppState>,
    request: Request,
) -> Result<Response, ApiError> {
    let (mut parts, bytes) = json_first(request).await?;
    let DbUser(user) = DbUser::from_request_parts(&mut parts, &state).await?;
    let updates = parse_updates(Body::parse(&bytes, &parts.headers, Extra::Forbid)?)?;
    set_preferences(&state.db, user.id, &updates, "settings").await?;
    Ok(no_content())
}

/// `html.escape(value, quote=True)`.
fn escape_html(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&#x27;"),
            other => escaped.push(other),
        }
    }
    escaped
}

fn html(body: String) -> Response {
    ([(header::CONTENT_TYPE, "text/html; charset=utf-8")], body).into_response()
}

fn required_token(query: &QueryParams) -> Result<String, ApiError> {
    let mut check = Validator::default();
    let token = check.query(query, "token").string(Length::default());
    check.finish()?;
    Ok(token)
}

fn verify(
    state: &AppState,
    token: &str,
) -> Result<Option<unsubscribe::UnsubscribeTarget>, ApiError> {
    Ok(unsubscribe::verify_token(
        &state.settings.email_unsubscribe_secret,
        token,
    )?)
}

/// The confirmation page: a GET never changes anything, so link scanners
/// that open every link cannot unsubscribe anyone.
fn confirmation_page(token: &str, valid: bool) -> String {
    let (message, action) = if valid {
        (
            "Confirm that you want to stop these wat2do emails.",
            format!(
                "<form method=\"post\" action=\"?token={}\"><button type=\"submit\">Unsubscribe</button></form>",
                escape_html(token)
            ),
        )
    } else {
        ("This unsubscribe link is invalid.", String::new())
    };
    format!(
        "<!doctype html><html><body><h1>wat2do email preferences</h1><p>{message}</p>{action}</body></html>"
    )
}

#[utoipa::path(
    get,
    path = "/notification-preferences/unsubscribe",
    tag = "notifications",
    operation_id = "confirm_unsubscribe_notification_preferences_unsubscribe_get",
    summary = "Confirm Unsubscribe"
)]
pub async fn confirm_unsubscribe(
    State(state): State<AppState>,
    query: QueryParams,
) -> Result<Response, ApiError> {
    let token = required_token(&query)?;
    let valid = verify(&state, &token)?.is_some();
    Ok(html(confirmation_page(&token, valid)))
}

#[utoipa::path(
    post,
    path = "/notification-preferences/unsubscribe",
    tag = "notifications",
    operation_id = "apply_unsubscribe_notification_preferences_unsubscribe_post",
    summary = "Apply Unsubscribe"
)]
pub async fn apply_unsubscribe(
    State(state): State<AppState>,
    query: QueryParams,
) -> Result<Response, ApiError> {
    let token = required_token(&query)?;
    if let Some(target) = verify(&state, &token)? {
        set_preferences(
            &state.db,
            target.user_id,
            &[(target.notification_type.to_owned(), false)],
            "unsubscribe",
        )
        .await?;
    }
    // The same page either way, so a guessed token learns nothing.
    Ok(html(
        "<!doctype html><html><body><h1>Email preference updated</h1>\
         <p>If the link was valid, this email notification has been turned off.</p>\
         </body></html>"
            .to_owned(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn parse(value: Value) -> Result<Vec<(String, bool)>, ApiError> {
        parse_updates(Body::from_value(value, Extra::Forbid))
    }

    fn issues(value: Value) -> Value {
        match parse(value) {
            Err(ApiError::RequestValidation(issues)) => json!(issues),
            other => panic!("expected a 422, got {other:?}"),
        }
    }

    #[test]
    fn every_type_resolves_to_a_choice_or_its_default() {
        // test_get_returns_only_active_preferences
        let at = Utc.with_ymd_and_hms(2026, 10, 1, 12, 0, 0).unwrap();
        let rows = vec![
            ("event_change".to_owned(), false, at),
            ("daily_new_events".to_owned(), true, at),
        ];
        let resolved = resolve(&rows);
        assert_eq!(
            serde_json::to_value(&resolved).unwrap(),
            json!([
                {"notification_type": "morning_email", "enabled": NOTIFICATION_DEFAULTS.morning_email, "updated_at": null},
                {"notification_type": "event_reminder", "enabled": NOTIFICATION_DEFAULTS.event_reminder, "updated_at": null},
                {"notification_type": "event_change", "enabled": false, "updated_at": "2026-10-01T12:00:00Z"},
            ])
        );
    }

    #[test]
    fn active_preferences_are_accepted_in_order() {
        // test_patch_accepts_active_preferences
        let updates = parse(json!({"preferences": [
            {"notification_type": "morning_email", "enabled": false},
            {"notification_type": "event_reminder", "enabled": true},
            {"notification_type": "event_change", "enabled": "yes"},
        ]}))
        .unwrap();
        assert_eq!(
            updates,
            [
                ("morning_email".to_owned(), false),
                ("event_reminder".to_owned(), true),
                ("event_change".to_owned(), true),
            ]
        );
    }

    #[test]
    fn forged_identity_and_removed_types_are_refused() {
        // test_preference_write_rejects_forged_identity, test_patch_rejects_removed_digest_type
        let one = json!([{"notification_type": "morning_email", "enabled": true}]);
        let forged = issues(json!({"preferences": one, "user_id": "x"}));
        assert_eq!(forged[0]["type"], "extra_forbidden");
        assert_eq!(forged[0]["loc"], json!(["body", "user_id"]));
        let source = issues(json!({"preferences": one, "source": "unsubscribe"}));
        assert_eq!(source[0]["loc"], json!(["body", "source"]));
        let retired = issues(json!({"preferences": [
            {"notification_type": "daily_new_events", "enabled": true}
        ]}));
        assert_eq!(retired[0]["type"], "literal_error");
        assert_eq!(
            retired[0]["loc"],
            json!(["body", "preferences", 0, "notification_type"])
        );
        assert_eq!(
            retired[0]["msg"],
            "Input should be 'morning_email', 'event_reminder' or 'event_change'"
        );
        let nested_extra = issues(json!({"preferences": [
            {"notification_type": "morning_email", "enabled": true, "user_id": "x"}
        ]}));
        assert_eq!(
            nested_extra[0]["loc"],
            json!(["body", "preferences", 0, "user_id"])
        );
    }

    #[test]
    fn the_list_needs_one_to_thirty_two_choices() {
        assert_eq!(issues(json!({}))[0]["type"], "missing");
        assert_eq!(issues(json!({"preferences": null}))[0]["type"], "list_type");
        assert_eq!(issues(json!({"preferences": []}))[0]["type"], "too_short");
        let many: Vec<Value> = (0..33)
            .map(|_| json!({"notification_type": "morning_email", "enabled": true}))
            .collect();
        assert_eq!(issues(json!({"preferences": many}))[0]["type"], "too_long");
        let missing = issues(json!({"preferences": [{"notification_type": "morning_email"}]}));
        assert_eq!(
            missing[0]["loc"],
            json!(["body", "preferences", 0, "enabled"])
        );
    }

    #[test]
    fn the_confirmation_page_posts_the_token_in_the_query() {
        // test_unsubscribe_confirmation_posts_token_in_query
        let page = confirmation_page("signed-token", true);
        assert!(page.contains(r#"method="post" action="?token=signed-token""#));
        assert!(!page.contains(r#"name="token""#));
        let hostile = confirmation_page("a\"><script>'&", true);
        assert!(hostile.contains("?token=a&quot;&gt;&lt;script&gt;&#x27;&amp;\""));
        let invalid = confirmation_page("signed-token", false);
        assert_eq!(
            invalid,
            "<!doctype html><html><body><h1>wat2do email preferences</h1><p>This unsubscribe link is invalid.</p></body></html>"
        );
    }
}

/// `set_notification_preferences` against a real Postgres loaded with our
/// schema; it runs only when `WAT2DO_TEST_DATABASE_URL` is set (CI's
/// "Rust database tests" job).
#[cfg(test)]
mod database_tests {
    use super::*;
    use crate::api::test_database::database;

    #[tokio::test]
    async fn choices_and_unsubscribes_are_recorded_with_their_evidence() {
        let Some(db) = database() else { return };
        let id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO public.users (id, email, auth_id, full_name) VALUES ($1, $2, $3, 'Reader')",
        )
        .bind(id)
        .bind(format!("reader-{}@example.com", id.simple()))
        .bind(id.to_string())
        .execute(&db)
        .await
        .unwrap();
        let defaults = preferences(&db, id).await.unwrap();
        assert!(defaults.iter().all(|choice| choice.updated_at.is_none()));

        set_preferences(
            &db,
            id,
            &[
                ("morning_email".to_owned(), false),
                ("event_change".to_owned(), true),
            ],
            "settings",
        )
        .await
        .unwrap();
        let chosen = preferences(&db, id).await.unwrap();
        assert!(!chosen[0].enabled && chosen[0].updated_at.is_some());
        assert!(chosen[1].updated_at.is_none());
        assert!(chosen[2].enabled && chosen[2].updated_at.is_some());

        let token = unsubscribe::create_token("database-test-secret", id, "event_change").unwrap();
        let target = unsubscribe::verify_token("database-test-secret", &token)
            .unwrap()
            .unwrap();
        set_preferences(
            &db,
            target.user_id,
            &[(target.notification_type.to_owned(), false)],
            "unsubscribe",
        )
        .await
        .unwrap();
        assert!(!preferences(&db, id).await.unwrap()[2].enabled);
        let sources: Vec<String> = sqlx::query_scalar(
            "SELECT source FROM public.notification_consent_history WHERE user_id = $1 \
             ORDER BY recorded_at, source",
        )
        .bind(id)
        .fetch_all(&db)
        .await
        .unwrap();
        assert_eq!(sources.len(), 3);
        assert!(sources.contains(&"unsubscribe".to_owned()));
        // An unsubscribe link can only turn an email off.
        assert!(
            set_preferences(&db, id, &[("event_change".to_owned(), true)], "unsubscribe")
                .await
                .is_err()
        );
    }
}
