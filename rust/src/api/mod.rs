//! The public API server (`wat2do-api`), being ported route by route from
//! `backend/main.py` and `backend/routers`.
//!
//! Routes Rust serves are registered in `rust_routes`; every other request
//! is proxied to the Python app (`proxy::to_python`) until its router is
//! ported. Rust routes behave like FastAPI routes: the same CORS and security
//! headers, error bodies, validation errors, slash redirects and 405s.
//! `docs/rust_api.md` explains how to port a router.

pub mod allowed_emails;
pub mod auth;
pub mod body;
pub mod client_ip;
pub mod cors;
pub mod email_address;
pub mod errors;
pub mod json;
pub mod messages;
pub mod pagination;
pub mod proxy;
pub mod rate_limit;
pub mod replay;
pub mod routes;
pub mod routing;
pub mod security_headers;
pub mod supervisor;
pub mod validation;

use std::sync::Arc;

use axum::Router;
use axum::middleware::{from_fn, from_fn_with_state};
use axum::routing::any;
use sqlx::PgPool;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::settings::Settings;
use auth::AccessTokens;
use client_ip::ProxyTrust;
use proxy::Upstream;

/// Everything a request handler can reach.
#[derive(Clone)]
pub struct AppState {
    pub settings: &'static Settings,
    pub db: PgPool,
    pub auth: Arc<AccessTokens>,
    pub trust: Arc<ProxyTrust>,
    /// The Python app; `None` when Rust runs alone (the parity replay).
    pub upstream: Option<Arc<Upstream>>,
}

impl AppState {
    pub fn new(
        settings: &'static Settings,
        db: PgPool,
        upstream: Option<Arc<Upstream>>,
    ) -> anyhow::Result<Self> {
        // Starlette reflects the caller's Origin for "*" with credentials,
        // which would let any site make authenticated requests.
        anyhow::ensure!(
            !settings.cors_origins.iter().any(|origin| origin == "*"),
            "CORS_ORIGINS must not contain '*' when credentials are enabled. \
             Set explicit origins, e.g. CORS_ORIGINS=[\"https://wat2do.io\"]"
        );
        Ok(Self {
            settings,
            db,
            auth: Arc::new(AccessTokens::new(settings)),
            trust: Arc::new(ProxyTrust::new(settings)),
            upstream,
        })
    }
}

/// Every route Rust serves, with its OpenAPI operation. Add a ported router's
/// handlers here, in the order FastAPI registered them.
fn rust_routes() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(routes::health::health))
        .routes(routes!(routes::site_banner::get_site_banner))
        // routers/clubs.py
        .routes(routes!(
            routes::clubs::list_clubs,
            routes::clubs::create_club
        ))
        .routes(routes!(routes::clubs::list_clubs_for_review))
        .routes(routes!(routes::clubs::list_my_clubs))
        .routes(routes!(routes::clubs::claims::list_claims))
        .routes(routes!(
            routes::clubs::get_club_route,
            routes::clubs::update_club,
            routes::clubs::delete_club
        ))
        .routes(routes!(routes::clubs::review_club))
        .routes(routes!(
            routes::clubs::members::list_club_members,
            routes::clubs::members::add_club_member
        ))
        .routes(routes!(routes::clubs::members::remove_club_member))
        .routes(routes!(
            routes::clubs::invitations::create_invitation,
            routes::clubs::invitations::list_invitations
        ))
        .routes(routes!(routes::clubs::invitations::revoke_invitation))
        .routes(routes!(routes::clubs::invitations::get_invitation_by_token))
        .routes(routes!(routes::clubs::invitations::accept_invitation))
        .routes(routes!(routes::clubs::claims::create_claim))
        .routes(routes!(routes::clubs::claims::update_claim))
        // routers/discovery_queries.py
        .routes(routes!(
            routes::discovery_queries::record_query,
            routes::discovery_queries::list_queries
        ))
        .routes(routes!(routes::ingestion_latency::get_ingestion_latency))
        .routes(routes!(routes::meta::get_constants))
        // routers/positions.py
        .routes(routes!(routes::positions::list_positions))
        .routes(routes!(routes::positions::get_position_stats))
        .routes(routes!(routes::positions::get_position))
        // routers/saved_clubs.py
        .routes(routes!(routes::saved_clubs::list_saved_clubs))
        .routes(routes!(
            routes::saved_clubs::save_club,
            routes::saved_clubs::unsave_club
        ))
        // routers/schools.py
        .routes(routes!(routes::schools::search_schools))
        .routes(routes!(routes::schools::get_school))
        // routers/users.py
        .routes(routes!(routes::users::get_me, routes::users::update_me))
        .routes(routes!(routes::users::update_profile))
        .routes(routes!(routes::users::update_promoter_enrollment))
        .routes(routes!(routes::users::list_users))
        .routes(routes!(
            routes::users::get_user_route,
            routes::users::delete_user
        ))
        .routes(routes!(routes::users::update_user_role))
}

/// The OpenAPI paths and schemas of the Rust routes, merged into FastAPI's
/// schema by `backend/core/openapi.py`.
pub fn openapi() -> utoipa::openapi::OpenApi {
    let mut document = rust_routes().into_openapi();
    if let Some(components) = document.components.as_mut() {
        for name in routes::FASTAPI_SCHEMAS {
            components.schemas.remove(name);
        }
    }
    document
}

/// The routed application between the steps that run before and after routing.
pub type App = tower::util::MapResponse<
    tower::util::MapRequest<Router, fn(axum::extract::Request) -> axum::extract::Request>,
    fn(axum::response::Response) -> axum::response::Response,
>;

/// The service that is served: `router` routing on the decoded path.
pub fn app(router: Router) -> App {
    tower::ServiceBuilder::new()
        .map_response(cors::finish as fn(_) -> _)
        .map_request(routing::prepare as fn(_) -> _)
        .service(router)
}

/// The application: Rust routes with FastAPI's behaviour, then the Python app.
pub fn router(state: AppState) -> Router {
    let (mut router, api) = rust_routes().split_for_parts();
    let paths: Vec<String> = api.paths.paths.keys().cloned().collect();
    for path in &paths {
        if let Some(variant) = routing::slash_variant(path)
            && !paths.contains(&variant)
        {
            router = router.route(&variant, any(routing::redirect_slash));
        }
    }
    let settings = state.settings;
    router
        .route_layer(from_fn(routing::starlette_methods))
        .route_layer(from_fn(errors::log_errors))
        .route_layer(from_fn_with_state(
            settings,
            security_headers::security_headers,
        ))
        .route_layer(from_fn_with_state(settings, cors::cors))
        .fallback(proxy::to_python)
        .with_state(state)
}

/// The Rust routes' OpenAPI fragment (`paths` and `components.schemas`), as
/// committed in `backend/core/rust_openapi.json`.
pub fn openapi_json() -> anyhow::Result<String> {
    let document = serde_json::to_value(openapi())?;
    let fragment = serde_json::json!({
        "paths": document["paths"],
        "components": {
            "schemas": document["components"]["schemas"].as_object().cloned().unwrap_or_default(),
        },
    });
    Ok(serde_json::to_string_pretty(&fragment)? + "\n")
}

#[cfg(test)]
mod tests;
