//! `GET /meta/constants`: the shared domain enums the frontend loads once
//! (`routers/meta.py`).

use axum::Json;
use axum::response::Response;
use indexmap::IndexMap;
use serde::Serialize;
use utoipa::ToSchema;

use crate::api::cache_control;
use crate::constants::{
    CLUB_CATEGORIES, EVENT_CATEGORIES, INTEREST_TO_CATEGORIES, REPORT_STATUSES,
};
use crate::controlbox::API_CACHE;

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
    description = "Return shared domain constants for frontend consumption.\n\nPublic and cacheable: the same for every visitor and changed only by a\ndeploy, so browsers and the CDN keep them as ``controlbox/api_cache.json``\nsays.",
    responses((status = 200, description = "Successful Response", body = AppConstantsResponse))
)]
pub async fn get_constants() -> Response {
    cache_control::shared(Json(constants()), &API_CACHE.constants)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn constants_keep_python_order() {
        let body = serde_json::to_string(&constants()).unwrap();
        assert!(
            body.starts_with(r#"{"event_categories":["Arts & Culture","Academics & Science","#)
        );
        assert!(body.contains(r#""interest_to_categories":{"Arts & Culture":["Arts & Culture"],"#));
        assert!(body.ends_with(r#""report_statuses":["pending","resolved","dismissed"]}"#));
    }
}
