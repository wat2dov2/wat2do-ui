//! `/webhooks/automate`, `/webhooks/automate/logs` and
//! `/webhooks/event-change-alerts` (`/webhooks/stripe` is `stripe_webhook.rs`).
//!
//! The event change emails are still written by Python
//! (`services/notifications/event_change.py`, which shares its rendering,
//! delivery log and unsubscribe links with the other Python notifications), so
//! the alerts webhook checks its caller here and then runs
//! `jobs/send_event_change_alerts.py` from the backend directory as a child process.

use std::process::Stdio;

use axum::Json;
use axum::extract::{Request, State};
use axum::http::{HeaderMap, StatusCode};
use serde::Serialize;
use serde_json::{Map, Value, json};
use tokio::process::Command;

use crate::api::AppState;
use crate::api::auth::{AdminUser, NOT_AUTHENTICATED, bearer_token};
use crate::api::body::{Body, Extra, Input, Str, json_first};
use crate::api::errors::ApiError;
use crate::api::events::store::POSTGREST_MAX_ROWS;
use crate::api::json;
use crate::api::validation::{Length, Limits, QueryParams, Validator};
use crate::automate_logs::create_automate_log;
use crate::db::read_with_retry;

const KEY_NOT_CONFIGURED: &str = "Webhook key not configured";
const INVALID_TOKEN: &str = "Invalid token";
const LOGS_FAILED: &str = "Failed to fetch logs";
/// Run from the backend directory, the API's working directory.
const ALERTS_JOB: &str = "jobs/send_event_change_alerts.py";

/// A `Bearer` token equal to `key`. An unset key refuses every caller.
fn require_bearer(headers: &HeaderMap, key: &str) -> Result<(), ApiError> {
    let token = bearer_token(headers).ok_or_else(|| ApiError::authentication(NOT_AUTHENTICATED))?;
    if key.is_empty() {
        return Err(ApiError::http(
            StatusCode::INTERNAL_SERVER_ERROR,
            KEY_NOT_CONFIGURED,
        ));
    }
    if aws_lc_rs::constant_time::verify_slices_are_equal(token.as_bytes(), key.as_bytes()).is_err()
    {
        return Err(ApiError::http(StatusCode::UNAUTHORIZED, INVALID_TOKEN));
    }
    Ok(())
}

#[allow(dead_code)]
#[derive(utoipa::ToSchema)]
pub struct AutomateLogPayload {
    event: String,
    #[schema(nullable)]
    sender: Option<String>,
    #[schema(nullable)]
    school: Option<String>,
    #[schema(nullable)]
    ig_account: Option<String>,
    #[schema(nullable)]
    post_url: Option<String>,
    #[schema(nullable)]
    payload: Option<Map<String, Value>>,
}

/// A validated `AutomateLogPayload` (unknown keys ignored).
#[derive(Debug, PartialEq)]
struct AutomateLog {
    event: String,
    sender: Option<String>,
    school: Option<String>,
    ig_account: Option<String>,
    post_url: Option<String>,
    payload: Option<Map<String, Value>>,
}

fn read_automate_log(mut body: Body) -> Result<AutomateLog, ApiError> {
    let text = Str::new();
    let event = body.required_string("event", &text);
    let sender = body.string("sender", &text).value();
    let school = body.string("school", &text).value();
    let ig_account = body.string("ig_account", &text).value();
    let post_url = body.string("post_url", &text).value();
    let payload = Input::value(body.object("payload"));
    body.finish()?;
    Ok(AutomateLog {
        event: event.ok_or_else(|| ApiError::Internal(anyhow::anyhow!("no automate event")))?,
        sender,
        school,
        ig_account,
        post_url,
        payload,
    })
}

impl AutomateLog {
    /// The stored row: the school the sender notifies when none was named,
    /// and the whole request as the payload when it brought none.
    fn row(self, sender_school: Option<String>) -> Value {
        let payload = match &self.payload {
            Some(payload) if !payload.is_empty() => Value::Object(payload.clone()),
            _ => json!({
                "event": self.event,
                "sender": self.sender,
                "school": self.school,
                "ig_account": self.ig_account,
                "post_url": self.post_url,
                "payload": self.payload,
            }),
        };
        let school = match self.school {
            Some(school) if !school.is_empty() => Some(school),
            school => sender_school.or(school),
        };
        json!({
            "event": self.event,
            "sender_id": self.sender,
            "school": school,
            "ig_account": self.ig_account,
            "post_url": self.post_url,
            "payload": payload,
        })
    }

    /// Whether the school must be looked up from the sender.
    fn needs_sender_school(&self) -> Option<&str> {
        let named = self
            .school
            .as_deref()
            .is_some_and(|school| !school.is_empty());
        self.sender
            .as_deref()
            .filter(|sender| !named && !sender.is_empty())
    }
}

#[utoipa::path(
    post,
    path = "/webhooks/automate",
    tag = "webhooks",
    operation_id = "receive_automate_log_webhooks_automate_post",
    summary = "Receive Automate Log",
    request_body = AutomateLogPayload,
    responses(
        (status = 200, description = "Successful Response", body = Value),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn receive_automate_log(
    State(state): State<AppState>,
    request: Request,
) -> Result<Json<Value>, ApiError> {
    let (parts, bytes) = json_first(request).await?;
    require_bearer(&parts.headers, &state.settings.automate_webhook_key)?;
    let log = Body::parse(&bytes, &parts.headers, Extra::Ignore).and_then(read_automate_log)?;
    let sender_school = match log.needs_sender_school() {
        Some(sender) => crate::schools::by_recipient_id(&state.db, sender)
            .await?
            .map(|school| school.slug),
        None => None,
    };
    // A log that cannot be stored is dropped (and logged), as before.
    create_automate_log(&state.db, &log.row(sender_school)).await;
    Ok(Json(json!({"status": "ok"})))
}

#[utoipa::path(
    post,
    path = "/webhooks/event-change-alerts",
    tag = "webhooks",
    operation_id = "send_event_change_alerts_webhooks_event_change_alerts_post",
    summary = "Send Event Change Alerts",
    description = "Called every minute by the scheduled event change alerts call.",
    responses((status = 200, description = "Successful Response", body = Value))
)]
pub async fn send_event_change_alerts(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    require_bearer(&headers, &state.settings.event_change_alerts_key)?;
    let mut command = Command::new("python");
    command.arg(ALERTS_JOB);
    let sent = run_alerts_job(command).await?;
    Ok(Json(json!({ "sent": sent })))
}

/// Run the alerts job and read how many emails it sent from the last line it
/// printed. It runs apart from the request, so a caller that hangs up never
/// cuts a send short; its log lines go to the API's own stderr.
async fn run_alerts_job(mut command: Command) -> Result<i64, ApiError> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());
    let output = tokio::spawn(async move { command.output().await })
        .await
        .map_err(|error| anyhow::anyhow!("event change alerts job: {error}"))?
        .map_err(|error| anyhow::anyhow!("event change alerts job did not start: {error}"))?;
    if !output.status.success() {
        return Err(anyhow::anyhow!("event change alerts job failed: {}", output.status).into());
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout
        .lines()
        .rev()
        .find(|line| !line.trim().is_empty())
        .and_then(|line| serde_json::from_str::<Value>(line).ok())
        .and_then(|result| result["sent"].as_i64())
        .ok_or_else(|| anyhow::anyhow!("event change alerts job printed no count").into())
}

/// Rows of `public.automate_logs` as PostgREST wrote them (its timestamp
/// text and the payload's key order), which FastAPI returned unchanged.
#[derive(Serialize)]
#[serde(transparent)]
pub struct AutomateLogs(#[serde(serialize_with = "json::repr_value")] Value);

#[utoipa::path(
    get,
    path = "/webhooks/automate/logs",
    tag = "webhooks",
    operation_id = "get_automate_logs_webhooks_automate_logs_get",
    summary = "Get Automate Logs",
    params(
        ("limit" = Option<i64>, Query),
        ("sender_id" = Option<String>, Query, nullable),
    ),
    responses(
        (status = 200, description = "Successful Response", body = Value),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn get_automate_logs(
    State(state): State<AppState>,
    AdminUser(_): AdminUser,
    query: QueryParams,
) -> Result<Json<AutomateLogs>, ApiError> {
    let mut check = Validator::default();
    let limit = check.query(&query, "limit").int_or(50, Limits::default());
    let sender_id = check
        .query(&query, "sender_id")
        .optional_string(Length::default());
    check.finish()?;
    let sender_id = sender_id.filter(|sender| !sender.is_empty());
    let logs = read_with_retry(|| {
        sqlx::query_scalar::<_, Value>(
            "SELECT coalesce(json_agg(json_build_object( \
                 'id', id, 'created_at', created_at, 'event', event, 'sender_id', sender_id, \
                 'school', school, 'ig_account', ig_account, 'post_url', post_url, \
                 'payload', payload) ORDER BY created_at DESC), '[]'::json) \
             FROM (SELECT * FROM public.automate_logs \
                   WHERE $2::text IS NULL OR sender_id = $2 \
                   ORDER BY created_at DESC LIMIT least($1, $3)) AS latest",
        )
        .bind(limit)
        .bind(&sender_id)
        .bind(POSTGREST_MAX_ROWS)
        .fetch_one(&state.db)
    })
    .await
    .map_err(|error| {
        tracing::error!("Failed to fetch automate logs: {error}");
        ApiError::http(StatusCode::INTERNAL_SERVER_ERROR, LOGS_FAILED)
    })?;
    Ok(Json(AutomateLogs(logs)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::{HeaderValue, header};

    fn bearer(token: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {token}")).unwrap(),
        );
        headers
    }

    fn status(result: Result<(), ApiError>) -> Option<StatusCode> {
        use axum::response::IntoResponse;
        result.err().map(|error| error.into_response().status())
    }

    #[test]
    fn only_the_configured_key_is_let_in() {
        // tests/routers/test_webhooks.py
        assert_eq!(
            status(require_bearer(&bearer("alerts-key"), "alerts-key")),
            None
        );
        assert_eq!(
            status(require_bearer(&bearer("wrong"), "alerts-key")),
            Some(StatusCode::UNAUTHORIZED)
        );
        assert_eq!(
            status(require_bearer(&HeaderMap::new(), "alerts-key")),
            Some(StatusCode::UNAUTHORIZED)
        );
        // Fails closed without a key, once a token was sent.
        assert_eq!(
            status(require_bearer(&bearer("anything"), "")),
            Some(StatusCode::INTERNAL_SERVER_ERROR)
        );
        assert_eq!(
            status(require_bearer(&HeaderMap::new(), "")),
            Some(StatusCode::UNAUTHORIZED)
        );
    }

    fn shell(script: &str) -> Command {
        let mut command = Command::new("sh");
        command.args(["-c", script]);
        command
    }

    #[tokio::test]
    async fn the_alerts_job_reports_how_many_emails_it_sent() {
        assert_eq!(
            run_alerts_job(shell(r#"echo 'starting'; echo '{"sent": 3}'; echo"#))
                .await
                .unwrap(),
            3
        );
        assert!(
            run_alerts_job(shell(r#"echo '{"sent": 3}'; exit 1"#))
                .await
                .is_err()
        );
        assert!(run_alerts_job(shell("echo done")).await.is_err());
        assert!(
            run_alerts_job(Command::new("/nonexistent/python"))
                .await
                .is_err()
        );
    }

    fn log(value: Value) -> Result<AutomateLog, ApiError> {
        read_automate_log(Body::from_value(value, Extra::Ignore))
    }

    #[test]
    fn automate_logs_need_an_event_and_ignore_other_keys() {
        let parsed = log(json!({"event": "queued", "sender": "12345", "extra": 1})).unwrap();
        assert_eq!(parsed.event, "queued");
        assert_eq!(parsed.sender.as_deref(), Some("12345"));
        for body in [
            json!({}),
            json!({"event": null}),
            json!({"event": 5}),
            json!({"event": "queued", "payload": []}),
            json!({"event": "queued", "school": 3}),
        ] {
            assert!(
                matches!(log(body.clone()), Err(ApiError::RequestValidation(_))),
                "{body}"
            );
        }
    }

    #[test]
    fn a_log_without_a_payload_stores_the_request_and_the_senders_school() {
        let parsed = log(json!({"event": "queued", "sender": "12345", "payload": {}})).unwrap();
        assert_eq!(parsed.needs_sender_school(), Some("12345"));
        assert_eq!(
            parsed.row(Some("uwaterloo".into())),
            json!({
                "event": "queued",
                "sender_id": "12345",
                "school": "uwaterloo",
                "ig_account": null,
                "post_url": null,
                "payload": {
                    "event": "queued", "sender": "12345", "school": null,
                    "ig_account": null, "post_url": null, "payload": {}
                },
            })
        );
        let named = log(json!({"event": "e", "sender": "1", "school": "mit", "payload": {"a": 1}}))
            .unwrap();
        assert_eq!(named.needs_sender_school(), None);
        let row = named.row(None);
        assert_eq!(row["school"], "mit");
        assert_eq!(row["payload"], json!({"a": 1}));
        // An empty school stays empty when the sender notifies no school.
        let blank = log(json!({"event": "e", "sender": "1", "school": ""})).unwrap();
        assert_eq!(blank.needs_sender_school(), Some("1"));
        assert_eq!(blank.row(None)["school"], "");
    }
}
