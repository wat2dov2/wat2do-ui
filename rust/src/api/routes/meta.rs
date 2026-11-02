//! `GET /meta/constants`: the shared domain enums the frontend loads once
//! (`routers/meta.py`).

use axum::Json;
use axum::http::{HeaderValue, header};
use axum::response::{IntoResponse, Response};
use indexmap::IndexMap;
use serde::Serialize;
use utoipa::ToSchema;

use crate::constants::{CLUB_CATEGORIES, EVENT_CATEGORIES, INTEREST_TO_CATEGORIES, REPORT_STATUSES};

/// Shared domain constants that the frontend must stay in sync with.
///
/// The frontend fetches this once on app init so both layers
/// always agree on categories, interest mappings, and status enums.
#[derive(Debug, Serialize, ToSchema)]
pub struct AppConstantsResponse {
    #[schema(value_type = Vec<String>)]
    pub event_categories: Vec<&'static str>,
    #[schema(value_type = Vec<String>)]
    pub club_categories: Vec<&'static str>,
    #[schema(value_type = Vec<String>)]
    pub interests: Vec<&'static str>,
    #[schema(value_type = std::collections::HashMap<String, Vec<String>>)]
    pub interest_to_categories: IndexMap<&'static str, Vec<&'static str>>,
    #[schema(value_type = Vec<String>)]
    pub report_statuses: Vec<&'static str>,
}

fn constants() -> AppConstantsResponse {
    AppConstantsResponse {
        event_categories: EVENT_CATEGORIES.to_vec(),
        club_categories: CLUB_CATEGORIES.to_vec(),
        interests: INTEREST_TO_CATEGORIES
            .iter()
            .map(|(interest, _)| *interest)
            .collect(),
        interest_to_categories: INTEREST_TO_CATEGORIES
            .iter()
            .map(|(interest, categories)| (*interest, categories.to_vec()))
            .collect(),
        report_statuses: REPORT_STATUSES.to_vec(),
    }
}

#[utoipa::path(
    get,
    path = "/meta/constants",
    tag = "meta",
    operation_id = "get_constants_meta_constants_get",
    summary = "Get Constants",
    description = "Return shared domain constants for frontend consumption.\n\nPublic and cacheable. ``Cache-Control: public, max-age=60`` so repeat\nscrapes hit CDN/browser cache; 60 s keeps category/interest deploys\nvisible within a minute.",
    responses((status = 200, description = "Successful Response", body = AppConstantsResponse))
)]
pub async fn get_constants() -> Response {
    let mut response = Json(constants()).into_response();
    // Repeat scrapes hit CDN and browser caches; a minute keeps deploys visible.
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=60"),
    );
    response
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn constants_keep_python_order() {
        let body = serde_json::to_string(&constants()).unwrap();
        assert!(body.starts_with(r#"{"event_categories":["Arts & Culture","Academics & Science","#));
        assert!(body.contains(r#""interest_to_categories":{"Arts & Culture":["Arts & Culture"],"#));
        assert!(body.ends_with(r#""report_statuses":["pending","resolved","dismissed"]}"#));
    }
}
