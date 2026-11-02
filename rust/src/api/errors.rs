//! Domain errors and their HTTP responses: `core/exceptions.py` and the
//! handlers in `core/error_handlers.py`, with the same status codes, headers
//! and JSON bodies.
//!
//! Handlers return `Result<_, ApiError>`. A response carries what to log as an
//! extension, and `log_errors` logs it with the request's method and path, as
//! the Python handlers do.

use axum::Json;
use axum::extract::Request;
use axum::http::{HeaderValue, StatusCode, header};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use serde_json::{Value, json};

use super::messages::{DB_OPERATION_FAILED, INTERNAL_SERVER_ERROR, PG_CODE_TO_HTTP};
use super::validation::ValidationIssue;

#[derive(Debug)]
pub enum ApiError {
    /// `NotFoundError`: 404.
    NotFound(String),
    /// `AuthenticationError`: 401 with `WWW-Authenticate: Bearer`.
    Authentication(String),
    /// `AuthorizationError`: 403.
    Authorization(String),
    /// `ConflictError`: 409.
    Conflict(String),
    /// `ValidationError`: 400, with `code` when one is set.
    Validation { detail: String, code: String },
    /// Any other `ServiceError`: 400, logged as a warning.
    Service { detail: String, code: String },
    /// `RateLimitExceeded`: 429 with `Retry-After`.
    RateLimited { detail: String, retry_after: u64 },
    /// `HTTPException(status, detail)`.
    Http { status: StatusCode, detail: String },
    /// FastAPI's `RequestValidationError`: 422 with pydantic's issue list.
    RequestValidation(Vec<ValidationIssue>),
    /// A database error: a known Postgres code maps to a safe status and
    /// message, any other database error is a 502, and a connection failure a 500.
    Database(sqlx::Error),
    /// Anything unexpected: 500, logged with its cause.
    Internal(anyhow::Error),
}

impl ApiError {
    pub fn not_found(detail: impl Into<String>) -> Self {
        Self::NotFound(detail.into())
    }
    pub fn authentication(detail: impl Into<String>) -> Self {
        Self::Authentication(detail.into())
    }
    pub fn authorization(detail: impl Into<String>) -> Self {
        Self::Authorization(detail.into())
    }
    pub fn conflict(detail: impl Into<String>) -> Self {
        Self::Conflict(detail.into())
    }
    pub fn validation(detail: impl Into<String>) -> Self {
        Self::Validation {
            detail: detail.into(),
            code: String::new(),
        }
    }
    pub fn http(status: StatusCode, detail: impl Into<String>) -> Self {
        Self::Http {
            status,
            detail: detail.into(),
        }
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(error)
    }
}

impl From<anyhow::Error> for ApiError {
    fn from(error: anyhow::Error) -> Self {
        Self::Internal(error)
    }
}

/// `core.exceptions.get_or_404`: the value, or a 404 with `detail`.
pub fn get_or_404<T>(value: Option<T>, detail: &str) -> Result<T, ApiError> {
    value.ok_or_else(|| ApiError::not_found(detail))
}

/// `_safe`: one line, so an attacker-controlled value cannot forge a log line.
pub fn safe(value: &str) -> String {
    value.replace('\r', "\\r").replace('\n', "\\n")
}

/// What `log_errors` writes for a response; `{route}` becomes "METHOD /path".
#[derive(Clone, Debug)]
pub struct ErrorLog {
    pub level: tracing::Level,
    pub message: String,
}

fn detail_body(detail: &str, code: &str) -> Value {
    if code.is_empty() {
        json!({ "detail": detail })
    } else {
        json!({ "detail": detail, "code": code })
    }
}

fn respond(status: StatusCode, body: Value) -> Response {
    (status, Json(body)).into_response()
}

fn logged(mut response: Response, level: tracing::Level, message: String) -> Response {
    response
        .extensions_mut()
        .insert(ErrorLog { level, message });
    response
}

fn database_response(error: sqlx::Error) -> Response {
    if matches!(error, sqlx::Error::PoolTimedOut) {
        // Every pooled connection is busy: fail fast instead of queueing requests.
        return logged(
            respond(
                StatusCode::SERVICE_UNAVAILABLE,
                json!({ "detail": DB_OPERATION_FAILED }),
            ),
            tracing::Level::WARN,
            "Database pool exhausted on {route}".to_owned(),
        );
    }
    let sqlx::Error::Database(database_error) = &error else {
        // A connection or protocol failure is not a Postgres answer; FastAPI
        // reports the equivalent PostgREST transport failure as a plain 500.
        return internal_response(&anyhow::Error::from(error));
    };
    let code = database_error
        .code()
        .map(|code| code.into_owned())
        .unwrap_or_default();
    let message = safe(database_error.message());
    if let Some((_, status, detail)) = PG_CODE_TO_HTTP.iter().find(|(known, ..)| *known == code) {
        let status = StatusCode::from_u16(*status).expect("valid status");
        return logged(
            respond(status, json!({ "detail": detail })),
            tracing::Level::WARN,
            format!(
                "Database error on {{route}} [pg_code={}]: {message}",
                safe(&code)
            ),
        );
    }
    if let Some(postgres) = database_error.try_downcast_ref::<sqlx::postgres::PgDatabaseError>() {
        // Hints and details often embed row values; keep them out of shared logs by default.
        tracing::debug!(
            "Database error extra: hint={} | details={}",
            safe(postgres.hint().unwrap_or_default()),
            safe(postgres.detail().unwrap_or_default())
        );
    }
    logged(
        respond(
            StatusCode::BAD_GATEWAY,
            json!({ "detail": DB_OPERATION_FAILED }),
        ),
        tracing::Level::ERROR,
        format!(
            "Unhandled database error on {{route}} [code={}]: {message}",
            safe(&code)
        ),
    )
}

fn internal_response(error: &anyhow::Error) -> Response {
    logged(
        respond(
            StatusCode::INTERNAL_SERVER_ERROR,
            json!({ "detail": INTERNAL_SERVER_ERROR }),
        ),
        tracing::Level::ERROR,
        format!("Unhandled error on {{route}}:\n{error:?}"),
    )
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        match self {
            Self::NotFound(detail) => respond(StatusCode::NOT_FOUND, json!({ "detail": detail })),
            Self::Authentication(detail) => {
                let mut response = respond(StatusCode::UNAUTHORIZED, json!({ "detail": detail }));
                response
                    .headers_mut()
                    .insert(header::WWW_AUTHENTICATE, HeaderValue::from_static("Bearer"));
                response
            }
            Self::Authorization(detail) => {
                respond(StatusCode::FORBIDDEN, json!({ "detail": detail }))
            }
            Self::Conflict(detail) => respond(StatusCode::CONFLICT, json!({ "detail": detail })),
            Self::Validation { detail, code } => {
                respond(StatusCode::BAD_REQUEST, detail_body(&detail, &code))
            }
            Self::Service { detail, code } => logged(
                respond(StatusCode::BAD_REQUEST, detail_body(&detail, &code)),
                tracing::Level::WARN,
                format!("Unhandled ServiceError on {{route}}: {}", safe(&detail)),
            ),
            Self::RateLimited {
                detail,
                retry_after,
            } => {
                let mut response =
                    respond(StatusCode::TOO_MANY_REQUESTS, json!({ "detail": detail }));
                response
                    .headers_mut()
                    .insert(header::RETRY_AFTER, HeaderValue::from(retry_after));
                response
            }
            Self::Http { status, detail } => respond(status, json!({ "detail": detail })),
            Self::RequestValidation(issues) => respond(
                StatusCode::UNPROCESSABLE_ENTITY,
                json!({ "detail": issues }),
            ),
            Self::Database(error) => database_response(error),
            Self::Internal(error) => internal_response(&error),
        }
    }
}

/// Log the error a response carries, with the request's method and path.
pub async fn log_errors(request: Request, next: Next) -> Response {
    let route = format!("{} {}", request.method(), request.uri().path());
    let response = next.run(request).await;
    if let Some(log) = response.extensions().get::<ErrorLog>() {
        let message = log.message.replace("{route}", &route);
        match log.level {
            tracing::Level::ERROR => tracing::error!("{message}"),
            tracing::Level::WARN => tracing::warn!("{message}"),
            _ => tracing::info!("{message}"),
        }
    }
    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use http_body_util::BodyExt;

    async fn parts(error: ApiError) -> (StatusCode, axum::http::HeaderMap, Value) {
        let response = error.into_response();
        let status = response.status();
        let headers = response.headers().clone();
        let body = response.into_body().collect().await.unwrap().to_bytes();
        (status, headers, serde_json::from_slice(&body).unwrap())
    }

    #[test]
    fn safe_strips_line_breaks() {
        // core/tests/test_error_handlers.py::TestSafe
        assert_eq!(safe("hello world"), "hello world");
        assert_eq!(safe("a\nb"), "a\\nb");
        assert_eq!(safe("a\rb"), "a\\rb");
        assert_eq!(safe("a\r\nb"), "a\\r\\nb");
    }

    #[tokio::test]
    async fn domain_errors_map_like_the_python_handlers() {
        let (status, headers, body) = parts(ApiError::not_found("Event not found")).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(body, json!({"detail": "Event not found"}));
        assert!(headers.get(header::WWW_AUTHENTICATE).is_none());

        let (status, headers, body) =
            parts(ApiError::authentication("Invalid or expired token")).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(headers[header::WWW_AUTHENTICATE], "Bearer");
        assert_eq!(body, json!({"detail": "Invalid or expired token"}));

        let (status, _, _) = parts(ApiError::authorization("Not authorized")).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        let (status, _, _) = parts(ApiError::conflict("taken")).await;
        assert_eq!(status, StatusCode::CONFLICT);

        let (status, _, body) = parts(ApiError::validation("bad")).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body, json!({"detail": "bad"}));
        let (_, _, body) = parts(ApiError::Validation {
            detail: "Needs a place".into(),
            code: "requires_location".into(),
        })
        .await;
        assert_eq!(
            body,
            json!({"detail": "Needs a place", "code": "requires_location"})
        );

        let (status, headers, body) = parts(ApiError::RateLimited {
            detail: crate::api::messages::RATE_LIMIT_EXCEEDED.into(),
            retry_after: 7,
        })
        .await;
        assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(headers[header::RETRY_AFTER], "7");
        assert_eq!(
            body,
            json!({"detail": "Too many requests \u{2014} please wait before trying again."})
        );

        let (status, _, body) = parts(ApiError::http(
            StatusCode::SERVICE_UNAVAILABLE,
            "Authentication error",
        ))
        .await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(body, json!({"detail": "Authentication error"}));
    }

    #[tokio::test]
    async fn unexpected_errors_are_500s_that_hide_the_cause() {
        let response = ApiError::Internal(anyhow::anyhow!("secret cause")).into_response();
        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
        let log = response.extensions().get::<ErrorLog>().unwrap().clone();
        assert!(log.message.contains("secret cause"));
        let body = response.into_body().collect().await.unwrap().to_bytes();
        assert_eq!(&body[..], br#"{"detail":"Internal server error"}"#);

        let (status, _, body) = parts(ApiError::Database(sqlx::Error::PoolClosed)).await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(body, json!({"detail": "Internal server error"}));

        let (status, _, body) = parts(ApiError::Database(sqlx::Error::PoolTimedOut)).await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(body, json!({"detail": "Database operation failed"}));
    }

    #[test]
    fn get_or_404_returns_the_value_or_a_404() {
        assert_eq!(get_or_404(Some(3), "missing").unwrap(), 3);
        assert!(
            matches!(get_or_404::<i32>(None, "missing"), Err(ApiError::NotFound(detail)) if detail == "missing")
        );
    }
}
