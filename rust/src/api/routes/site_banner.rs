//! `GET /site-banner`: the one site-wide banner (`routers/site_banner.py`).

use axum::Json;
use axum::extract::State;
use axum::http::header::CONTENT_TYPE;
use axum::http::{HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use serde::Serialize;
use utoipa::ToSchema;

use crate::api::AppState;
use crate::api::errors::ApiError;

/// The single site-wide banner, as shown above the navigation.
#[derive(Debug, PartialEq, Serialize, ToSchema)]
#[schema(title = "SiteBannerResponse")]
pub struct SiteBannerResponse {
    pub message_translation_key: String,
    pub cta_label_translation_key: String,
    pub cta_href: String,
}

#[derive(sqlx::FromRow)]
struct SiteBannerRow {
    message_translation_key: String,
    cta_label_translation_key: String,
    cta_href: String,
    enabled: bool,
}

/// A disabled banner reads as absent rather than as empty copy, so callers
/// render nothing at all instead of an empty bar.
fn shown(row: Option<SiteBannerRow>) -> Option<SiteBannerResponse> {
    row.filter(|row| row.enabled).map(|row| SiteBannerResponse {
        message_translation_key: row.message_translation_key,
        cta_label_translation_key: row.cta_label_translation_key,
        cta_href: row.cta_href,
    })
}

#[utoipa::path(
    get,
    path = "/site-banner",
    tag = "site-banner",
    operation_id = "get_site_banner_endpoint_site_banner_get",
    summary = "Get Site Banner Endpoint",
    description = "Public: the banner shown above the navigation, or nothing when disabled.",
    responses((status = 200, description = "Successful Response", body = Option<SiteBannerResponse>))
)]
pub async fn get_site_banner(State(state): State<AppState>) -> Result<Response, ApiError> {
    let row = crate::db::read_with_retry(|| {
        sqlx::query_as::<_, SiteBannerRow>(
            "SELECT message_translation_key, cta_label_translation_key, cta_href, enabled \
             FROM public.site_banner WHERE id = 1 LIMIT 1",
        )
        .fetch_optional(&state.db)
    })
    .await?;
    Ok(match shown(row) {
        Some(banner) => Json(banner).into_response(),
        None => {
            // FastAPI keeps the JSON content type on its empty 204.
            let mut response = StatusCode::NO_CONTENT.into_response();
            response
                .headers_mut()
                .insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
            response
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(enabled: bool) -> SiteBannerRow {
        SiteBannerRow {
            message_translation_key: "siteBanner.businessSupport.message".into(),
            cta_label_translation_key: "siteBanner.businessSupport.cta".into(),
            cta_href: "/support-local".into(),
            enabled,
        }
    }

    #[test]
    fn enabled_banner_returns_translation_keys() {
        // backend/tests/services/test_site_banner_service.py
        assert_eq!(
            shown(Some(row(true))),
            Some(SiteBannerResponse {
                message_translation_key: "siteBanner.businessSupport.message".into(),
                cta_label_translation_key: "siteBanner.businessSupport.cta".into(),
                cta_href: "/support-local".into(),
            })
        );
    }

    #[test]
    fn disabled_or_missing_banner_is_hidden() {
        assert_eq!(shown(Some(row(false))), None);
        assert_eq!(shown(None), None);
    }
}
