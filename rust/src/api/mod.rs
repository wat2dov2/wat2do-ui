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
pub mod contract;
pub mod cookies;
pub mod cors;
pub mod email_address;
pub mod errors;
pub mod events;
pub mod json;
pub mod messages;
pub mod multipart;
pub mod pagination;
pub mod proxy;
pub mod rate_limit;
pub mod replay;
pub mod routes;
pub mod routing;
pub mod secrets;
pub mod security_headers;
pub mod supervisor;
#[cfg(test)]
pub mod test_database;
pub mod tickets;
pub mod validation;

use std::sync::Arc;

use axum::Router;
use axum::middleware::{from_fn, from_fn_with_state};
use axum::routing::any;
use sqlx::PgPool;
use tower_http::compression::CompressionLayer;
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
    /// Where uploads are stored (S3 behind CloudFront).
    pub storage: Arc<crate::storage::Storage>,
}

impl AppState {
    pub fn new(
        settings: &'static Settings,
        db: PgPool,
        upstream: Option<Arc<Upstream>>,
    ) -> anyhow::Result<Self> {
        // The refresh token is a long-lived credential: never outside TLS.
        anyhow::ensure!(
            !settings.is_production() || settings.cookie_secure,
            "COOKIE_SECURE must be true in production (environment=production). \
             The refresh-token cookie cannot be served over plain HTTP."
        );
        // Starlette reflects the caller's Origin for "*" with credentials,
        // which would let any site make authenticated requests.
        anyhow::ensure!(
            !settings.cors_origins.iter().any(|origin| origin == "*"),
            "CORS_ORIGINS must not contain '*' when credentials are enabled. \
             Set explicit origins, e.g. CORS_ORIGINS=[\"https://wat2do.io\"]"
        );
        let auth = AccessTokens::new(settings);
        auth.check()?;
        Ok(Self {
            settings,
            db,
            auth: Arc::new(auth),
            trust: Arc::new(ProxyTrust::new(settings)),
            upstream,
            storage: Arc::new(crate::storage::Storage::new(settings)),
        })
    }
}

/// Every route Rust serves, with its OpenAPI operation. Add a ported router's
/// handlers here, in the order FastAPI registered them.
fn rust_routes() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(routes::health::health))
        // routers/ai.py
        .routes(routes!(routes::ai::parse_event_image))
        .routes(routes!(routes::ai::parse_position_image))
        // routers/auth.py
        .routes(routes!(routes::auth::start_google_oauth))
        .routes(routes!(routes::auth::complete_google_oauth))
        .routes(routes!(routes::auth::send_otp))
        .routes(routes!(routes::auth::verify_otp))
        .routes(routes!(routes::auth::refresh))
        .routes(routes!(routes::auth::logout))
        .routes(routes!(routes::calendar::get_calendar_token))
        .routes(routes!(routes::calendar::regenerate_calendar_token))
        .routes(routes!(routes::calendar::get_calendar_feed))
        .routes(routes!(routes::events::list_admin_events))
        .routes(routes!(routes::events::get_event_stats))
        .routes(routes!(
            routes::events::list_events,
            routes::events::create_event
        ))
        .routes(routes!(
            routes::events::get_event,
            routes::events::update_event,
            routes::events::delete_event
        ))
        .routes(routes!(routes::going_events::list_going_events))
        .routes(routes!(routes::going_events::list_event_attendees))
        .routes(routes!(
            routes::going_events::mark_going,
            routes::going_events::unmark_going
        ))
        // Club tickets (api/tickets)
        .routes(routes!(
            routes::event_ticketing::get_event_ticketing,
            routes::event_ticketing::configure_event_ticketing,
            routes::event_ticketing::stop_event_ticketing
        ))
        .routes(routes!(routes::event_ticketing::take_free_ticket))
        .routes(routes!(routes::event_ticketing::start_ticket_checkout))
        .routes(routes!(routes::event_ticketing::get_ticket_desk))
        .routes(routes!(routes::event_ticketing::set_ticket_check_in))
        .routes(routes!(routes::event_ticketing::refund_ticket))
        .routes(routes!(
            routes::event_ticketing::decline_ticket_refund_request
        ))
        .routes(routes!(routes::event_ticketing::refund_remaining_tickets))
        .routes(routes!(routes::tickets::list_my_tickets))
        .routes(routes!(routes::tickets::get_my_ticket_order))
        .routes(routes!(
            routes::tickets::get_ticket,
            routes::tickets::return_ticket
        ))
        .routes(routes!(routes::tickets::request_ticket_refund))
        .routes(routes!(routes::clubs::payouts::get_club_payouts))
        .routes(routes!(
            routes::clubs::payouts::start_club_payout_onboarding
        ))
        .routes(routes!(routes::clubs::payouts::list_club_ticket_sales))
        .routes(routes!(routes::stripe_webhook::receive_stripe_event))
        .routes(routes!(routes::interactions::record_interactions))
        .routes(routes!(
            routes::reports::create_report,
            routes::reports::list_reports
        ))
        .routes(routes!(routes::reports::update_report))
        .routes(routes!(routes::site_banner::get_site_banner))
        // routers/submissions.py
        .routes(routes!(
            routes::submissions::create_submission,
            routes::submissions::list_submissions
        ))
        .routes(routes!(
            routes::submissions::get_submission_route,
            routes::submissions::update_submission,
            routes::submissions::delete_submission
        ))
        // routers/uploads.py
        .routes(routes!(routes::uploads::upload_event_image_unsigned))
        .routes(routes!(routes::uploads::upload_event_image))
        .routes(routes!(routes::uploads::upload_avatar))
        .routes(routes!(routes::uploads::upload_club_logo))
        .routes(routes!(routes::uploads::upload_qr_asset))
        .routes(routes!(routes::uploads::upload_claim_proof))
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
        .routes(routes!(routes::contact::submit_contact_message))
        // routers/discovery_queries.py
        .routes(routes!(
            routes::discovery_queries::record_query,
            routes::discovery_queries::list_queries
        ))
        .routes(routes!(routes::ingestion_latency::get_ingestion_latency))
        .routes(routes!(routes::meta::get_constants))
        // routers/payouts.py
        .routes(routes!(routes::payouts::list_own_payouts))
        .routes(routes!(routes::payouts::list_admin_payouts))
        .routes(routes!(routes::payouts::export_pending_payouts))
        .routes(routes!(routes::payouts::get_admin_payout_detail))
        .routes(routes!(routes::payouts::transition_payout))
        .routes(routes!(routes::payouts::bulk_mark_paid))
        // routers/positions.py
        .routes(routes!(routes::positions::list_positions))
        .routes(routes!(routes::positions::get_position_stats))
        .routes(routes!(routes::positions::get_position))
        // routers/position_submissions.py
        .routes(routes!(
            routes::submissions::positions::create_submission,
            routes::submissions::positions::list_submissions
        ))
        .routes(routes!(routes::submissions::positions::review_submission))
        // routers/qr.py
        .routes(routes!(
            routes::qr::list_qr_codes_route,
            routes::qr::posters::create_poster
        ))
        .routes(routes!(routes::qr::list_scans))
        .routes(routes!(routes::qr::get_promoter_earnings))
        .routes(routes!(routes::qr::scans::confirm_scan))
        .routes(routes!(routes::qr::get_campus_coverage))
        .routes(routes!(
            routes::qr::scans::resolve_qr_and_record_scan,
            routes::qr::posters::update_poster,
            routes::qr::posters::delete_poster
        ))
        // routers/saved_clubs.py
        .routes(routes!(routes::saved_clubs::list_saved_clubs))
        .routes(routes!(
            routes::saved_clubs::save_club,
            routes::saved_clubs::unsave_club
        ))
        // routers/schools.py
        .routes(routes!(routes::schools::search_schools))
        .routes(routes!(routes::schools::get_school))
        // routers/sponsor_submissions.py
        .routes(routes!(
            routes::sponsor_submissions::create_submission,
            routes::sponsor_submissions::list_submissions
        ))
        .routes(routes!(routes::sponsor_submissions::review_submission))
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
        .routes(routes!(routes::v1_saved_events::list_saved_events))
        .routes(routes!(
            routes::v1_saved_events::save_event,
            routes::v1_saved_events::unsave_event
        ))
        // routers/competitor_pain_points.py
        .routes(routes!(routes::competitor_pain_points::list_pain_points))
        .routes(routes!(routes::competitor_pain_points::list_reports))
        .routes(routes!(routes::competitor_pain_points::review_pain_point))
        // routers/outreach.py
        .routes(routes!(routes::outreach::list_leads))
        .routes(routes!(routes::outreach::update_lead))
        // routers/webhooks.py
        .routes(routes!(routes::webhooks::receive_automate_log))
        .routes(routes!(routes::webhooks::send_event_change_alerts))
        .routes(routes!(routes::webhooks::get_automate_logs))
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
    routes::static_path_fallbacks(router)
        .route_layer(from_fn(routing::starlette_methods))
        .route_layer(from_fn(errors::log_errors))
        .route_layer(from_fn_with_state(
            settings,
            security_headers::security_headers,
        ))
        .route_layer(from_fn_with_state(settings, cors::cors))
        .fallback(proxy::to_python)
        // Responses leave the Mac over its slow uplink, so they go compressed
        // (Rust's and Python's alike) to every client that accepts it.
        .layer(CompressionLayer::new())
        .with_state(state)
}

/// The Rust routes' OpenAPI fragment (`paths` and `components.schemas`), as
/// committed in `backend/core/rust_openapi.json`.
pub fn openapi_json() -> anyhow::Result<String> {
    let document = serde_json::to_value(openapi())?;
    let mut fragment = serde_json::json!({
        "paths": document["paths"],
        "components": {
            "schemas": document["components"]["schemas"].as_object().cloned().unwrap_or_default(),
        },
    });
    contract::apply(&mut fragment);
    Ok(serde_json::to_string_pretty(&fragment)? + "\n")
}

#[cfg(test)]
mod tests;
