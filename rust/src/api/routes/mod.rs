//! Routes ported from `backend/routers`, one module per FastAPI router.

pub mod ai;
pub mod auth;
pub mod calendar;
pub mod clubs;
pub mod contact;
pub mod discovery_queries;
pub mod event_ticketing;
pub mod events;
pub mod going_events;
pub mod health;
pub mod ingestion_latency;
pub mod interactions;
pub mod meta;
pub mod payouts;
pub mod positions;
pub mod qr;
pub mod reports;
pub mod saved_clubs;
pub mod schools;
pub mod site_banner;
pub mod sponsor_submissions;
pub mod stripe_webhook;
pub mod submissions;
pub mod tickets;
pub mod uploads;
pub mod users;
pub mod v1_saved_events;

use axum::Router;
use axum::routing::{get, patch};
use utoipa::ToSchema;

use super::AppState;

/// Starlette tries every route in order, so a method a static path refuses
/// still reaches a later parameter route that accepts it (`PATCH /qr/scans`
/// edits the poster "scans"). axum stops at the static path, so those
/// methods are added to it here, outside the OpenAPI document.
pub fn static_path_fallbacks(router: Router<AppState>) -> Router<AppState> {
    let mut router = router;
    for path in ["/qr/scans", "/qr/earnings", "/qr/map"] {
        router = router.route(
            path,
            patch(qr::posters::update_static_path).delete(qr::posters::delete_static_path),
        );
    }
    for path in ["/payouts/admin/export", "/payouts/admin/mark-paid"] {
        router = router.route(path, get(payouts::detail_of_static_path));
    }
    router
}

/// FastAPI's 422 body. Its OpenAPI schema stays FastAPI's own (as do the
/// other names in `FASTAPI_SCHEMAS`): the Rust fragment only refers to it,
/// since `core/openapi.py` refuses a schema both apps define differently.
#[derive(ToSchema)]
#[schema(as = HTTPValidationError)]
pub struct HttpValidationError {
    pub detail: Vec<serde_json::Value>,
}

/// Schemas the Rust routes use but FastAPI's routes still define.
pub const FASTAPI_SCHEMAS: [&str; 4] = [
    "HTTPValidationError",
    "ValidationError",
    "ClubCohostResponse",
    "LatestAddedItem",
];
