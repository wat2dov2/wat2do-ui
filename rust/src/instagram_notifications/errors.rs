//! The failures the Brave services tell apart, mirroring the Python exception classes.
//!
//! The worker's decisions (retry a read, hold for a rate limit, pause for a person)
//! depend on which of these a step raised, so every variant keeps its Python meaning.
//! `Display` is Python's `str(exc)`: the sanitized message stored on jobs and pauses.

use std::fmt;

use serde_json::Value;

/// Subclasses of Python's `BrowserSessionError`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionKind {
    /// `BrowserSessionError` itself: a sanitized failure in the shared browser session.
    Session,
    /// `BrowserEngagementUncertain`: a native action may have run without verified completion.
    EngagementUncertain,
    /// `_BrowserAutomationTransient`: the Apple Event bridge is unavailable; idempotent reads may retry.
    AutomationTransient,
    /// `_BrowserTabUnavailable`: the exact pinned document is gone.
    TabUnavailable,
    /// `BrowserAccountChanged`: the shared login changed.
    AccountChanged,
    /// `BrowserRateLimited`: Instagram returned a verified HTTP 429.
    RateLimited,
    /// `_BrowserPageUnavailable`: page readiness or an account control is not ready yet.
    PageUnavailable,
    /// `BrowserDigestError`: a sanitized digest failure.
    Digest,
    /// A password reached Instagram and the login did not finish cleanly: never retried
    /// automatically; it pauses browser work for a person.
    LoginSubmitted,
}

/// A queue storage failure (Python's `sqlite3.Error`), keeping SQLite's result code.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StorageError {
    /// The extended SQLite result code, when SQLite reported one.
    pub code: Option<i32>,
    pub message: String,
}

impl StorageError {
    /// The primary result code (`code & 0xFF`).
    pub fn primary_code(&self) -> Option<i32> {
        self.code.map(|code| code & 0xFF)
    }
}

impl From<rusqlite::Error> for StorageError {
    fn from(error: rusqlite::Error) -> Self {
        let code = match &error {
            rusqlite::Error::SqliteFailure(failure, _) => Some(failure.extended_code),
            _ => None,
        };
        Self {
            code,
            message: error.to_string(),
        }
    }
}

#[derive(Debug, Clone)]
pub enum BrowserError {
    Session {
        kind: SessionKind,
        message: String,
    },
    /// `_BrowserReadCleanupPending`: a secondary read that the batch owner settles later.
    ReadCleanupPending {
        message: String,
        operation_error: Option<Box<BrowserError>>,
        completed_payload: Option<Value>,
    },
    /// Python's `TimeoutError`.
    Timeout(String),
    /// `KeyboardInterrupt` or `SystemExit`: the worker was told to stop.
    Interrupted,
    /// `sqlite3.Error`.
    Storage(StorageError),
    /// `ValueError`.
    Value(String),
    /// Any other exception, named by its Python class for sanitized job errors.
    Other {
        type_name: String,
        message: String,
    },
}

pub type BrowserResult<T> = Result<T, BrowserError>;

impl BrowserError {
    pub fn session(message: impl Into<String>) -> Self {
        Self::of(SessionKind::Session, message)
    }

    pub fn of(kind: SessionKind, message: impl Into<String>) -> Self {
        Self::Session {
            kind,
            message: message.into(),
        }
    }

    pub fn transient(message: impl Into<String>) -> Self {
        Self::of(SessionKind::AutomationTransient, message)
    }

    pub fn tab_unavailable(message: impl Into<String>) -> Self {
        Self::of(SessionKind::TabUnavailable, message)
    }

    pub fn page_unavailable(message: impl Into<String>) -> Self {
        Self::of(SessionKind::PageUnavailable, message)
    }

    pub fn account_changed(message: impl Into<String>) -> Self {
        Self::of(SessionKind::AccountChanged, message)
    }

    pub fn rate_limited(message: impl Into<String>) -> Self {
        Self::of(SessionKind::RateLimited, message)
    }

    pub fn uncertain(message: impl Into<String>) -> Self {
        Self::of(SessionKind::EngagementUncertain, message)
    }

    pub fn digest(message: impl Into<String>) -> Self {
        Self::of(SessionKind::Digest, message)
    }

    pub fn other(type_name: &str, message: impl Into<String>) -> Self {
        Self::Other {
            type_name: type_name.to_owned(),
            message: message.into(),
        }
    }

    /// `isinstance(exc, BrowserSessionError)`.
    pub fn is_session(&self) -> bool {
        matches!(self, Self::Session { .. } | Self::ReadCleanupPending { .. })
    }

    /// `isinstance(exc, <that exact subclass>)`; `Session` matches only the base class's
    /// own instances, so use [`Self::is_session`] for the whole hierarchy.
    pub fn is(&self, kind: SessionKind) -> bool {
        matches!(self, Self::Session { kind: actual, .. } if *actual == kind)
    }

    pub fn is_timeout(&self) -> bool {
        matches!(self, Self::Timeout(_))
    }

    pub fn is_interrupted(&self) -> bool {
        matches!(self, Self::Interrupted)
    }

    pub fn is_storage(&self) -> bool {
        matches!(self, Self::Storage(_))
    }

    pub fn is_cleanup_pending(&self) -> bool {
        matches!(self, Self::ReadCleanupPending { .. })
    }

    /// `type(exc).__name__`, for the sanitized "Browser job failed (...)" messages.
    pub fn type_name(&self) -> String {
        match self {
            Self::Session { kind, .. } => match kind {
                SessionKind::Session => "BrowserSessionError",
                SessionKind::EngagementUncertain => "BrowserEngagementUncertain",
                SessionKind::AutomationTransient => "_BrowserAutomationTransient",
                SessionKind::TabUnavailable => "_BrowserTabUnavailable",
                SessionKind::AccountChanged => "BrowserAccountChanged",
                SessionKind::RateLimited => "BrowserRateLimited",
                SessionKind::PageUnavailable => "_BrowserPageUnavailable",
                SessionKind::Digest => "BrowserDigestError",
                SessionKind::LoginSubmitted => "BrowserSessionError",
            }
            .to_owned(),
            Self::ReadCleanupPending { .. } => "_BrowserReadCleanupPending".to_owned(),
            Self::Timeout(_) => "TimeoutError".to_owned(),
            Self::Interrupted => "KeyboardInterrupt".to_owned(),
            Self::Storage(_) => "OperationalError".to_owned(),
            Self::Value(_) => "ValueError".to_owned(),
            Self::Other { type_name, .. } => type_name.clone(),
        }
    }
}

impl fmt::Display for BrowserError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Session { message, .. }
            | Self::ReadCleanupPending { message, .. }
            | Self::Timeout(message)
            | Self::Value(message)
            | Self::Other { message, .. } => formatter.write_str(message),
            Self::Storage(error) => formatter.write_str(&error.message),
            Self::Interrupted => Ok(()),
        }
    }
}

impl std::error::Error for BrowserError {}

impl From<StorageError> for BrowserError {
    fn from(error: StorageError) -> Self {
        Self::Storage(error)
    }
}

impl From<rusqlite::Error> for BrowserError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Storage(error.into())
    }
}
