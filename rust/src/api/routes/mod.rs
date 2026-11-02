//! Routes ported from `backend/routers`, one module per FastAPI router.

pub mod calendar;
pub mod clubs;
pub mod discovery_queries;
pub mod events;
pub mod going_events;
pub mod health;
pub mod ingestion_latency;
pub mod interactions;
pub mod meta;
pub mod positions;
pub mod reports;
pub mod saved_clubs;
pub mod schools;
pub mod site_banner;
pub mod users;
pub mod v1_saved_events;

use utoipa::ToSchema;

/// FastAPI's 422 body. Its OpenAPI schema stays FastAPI's own (as do the
/// other names in `FASTAPI_SCHEMAS`): the Rust fragment only refers to it,
/// since `core/openapi.py` refuses a schema both apps define differently.
#[derive(ToSchema)]
#[schema(as = HTTPValidationError)]
pub struct HttpValidationError {
    pub detail: Vec<serde_json::Value>,
}

/// Schemas the Rust routes use but FastAPI's routes still define.
pub const FASTAPI_SCHEMAS: [&str; 5] = [
    "HTTPValidationError",
    "ValidationError",
    "ClubCohostResponse",
    "LatestAddedItem",
    "SubmissionUpdate",
];
