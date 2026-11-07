//! FastAPI's OpenAPI for the routes ported from it, kept exactly.
//!
//! The frontend's generated types come from the merged schema, and a schema
//! name shared with routes still in Python must be defined identically on
//! both sides (`backend/core/openapi.py` refuses a difference). So each ported
//! router commits FastAPI's operations and component schemas for its paths
//! (`routes/<router>_openapi.json`, cut from `frontend/src/shared/generated/openapi.json`
//! before the Python router was deleted), and they replace what utoipa
//! generated for those paths. Method order inside a path is FastAPI's
//! registration order, which Starlette's 405 `Allow` header follows.

use std::sync::LazyLock;

use serde_json::{Map, Value};

const CONTRACTS: [&str; 4] = [
    include_str!("routes/events_openapi.json"),
    include_str!("routes/submissions_openapi.json"),
    include_str!("routes/uploads_openapi.json"),
    include_str!("routes/ai_openapi.json"),
];

static PARSED: LazyLock<Vec<Value>> = LazyLock::new(|| {
    CONTRACTS
        .iter()
        .map(|contract| serde_json::from_str(contract).expect("committed OpenAPI contract"))
        .collect()
});

/// The axum route for a FastAPI path: axum cannot route `{token}.ics`, so the
/// route takes the whole segment (`{token}`) and its handler checks the suffix.
pub fn route_path(fastapi_path: &str) -> String {
    fastapi_path
        .split('/')
        .map(|segment| match segment.find('}') {
            Some(end) if segment.starts_with('{') => &segment[..=end],
            _ => segment,
        })
        .collect::<Vec<_>>()
        .join("/")
}

/// Replace the generated operations of every contract path, and add the
/// contract's schemas, in an OpenAPI fragment (`{"paths", "components"}`).
pub fn apply(fragment: &mut Value) {
    for contract in PARSED.iter() {
        let contract_paths = contract["paths"].as_object().expect("contract paths");
        let generated = fragment["paths"].as_object().cloned().unwrap_or_default();
        let mut paths = Map::new();
        for (path, item) in generated {
            match contract_paths
                .iter()
                .find(|(fastapi_path, _)| route_path(fastapi_path) == path)
            {
                Some((fastapi_path, contract_item)) => {
                    paths.insert(fastapi_path.clone(), contract_item.clone());
                }
                None => {
                    paths.insert(path, item);
                }
            }
        }
        fragment["paths"] = Value::Object(paths);
        let schemas = fragment["components"]["schemas"]
            .as_object_mut()
            .expect("components.schemas");
        for (name, schema) in contract["schemas"].as_object().expect("contract schemas") {
            schemas.insert(name.clone(), schema.clone());
        }
        schemas.sort_keys();
    }
}

/// Each contract path's methods in FastAPI's order, keyed by axum route.
pub fn method_orders() -> Vec<(String, Vec<String>)> {
    PARSED
        .iter()
        .flat_map(|contract| {
            contract["paths"]
                .as_object()
                .expect("contract paths")
                .iter()
                .map(|(path, item)| {
                    let methods = item
                        .as_object()
                        .map(|methods| methods.keys().map(|method| method.to_uppercase()).collect())
                        .unwrap_or_default();
                    (route_path(path), methods)
                })
                .collect::<Vec<_>>()
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn suffixed_parameters_route_on_the_whole_segment() {
        assert_eq!(
            route_path("/calendar/feed/{token}.ics"),
            "/calendar/feed/{token}"
        );
        assert_eq!(route_path("/events/{event_id}"), "/events/{event_id}");
        assert_eq!(route_path("/events/"), "/events/");
    }

    #[test]
    fn reports_list_answers_405_with_post_first() {
        let orders = method_orders();
        let reports = orders.iter().find(|(path, _)| path == "/reports/").unwrap();
        assert_eq!(reports.1, ["POST", "GET"]);
    }
}
