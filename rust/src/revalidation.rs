//! Refreshing the frontend's cached school feeds (`services/event_feed_revalidation.py`).
//!
//! Fail-open: a write that already committed survives a delivery outage, and
//! the frontend's periodic reconciliation repairs a missed notice.

use std::time::Duration;

use crate::settings::settings;

/// Ask the frontend to refresh `resources` for each school, once per school.
pub async fn revalidate_schools(schools: &[String], resources: &[&str]) {
    let Ok(settings) = settings() else { return };
    let url = settings.event_feed_revalidation_url.as_str();
    if url.is_empty() {
        return;
    }
    let Ok(client) = wreq::Client::builder()
        .timeout(Duration::from_secs_f64(
            settings.event_feed_revalidation_timeout_seconds,
        ))
        .build()
    else {
        return;
    };
    let mut seen = std::collections::HashSet::new();
    for school in schools.iter().filter(|school| !school.is_empty()) {
        if !seen.insert(school) {
            continue;
        }
        let mut request = client
            .post(url)
            .json(&serde_json::json!({"school": school, "resources": resources}));
        if !settings.event_feed_revalidation_secret.is_empty() {
            request = request.bearer_auth(&settings.event_feed_revalidation_secret);
        }
        match request
            .send()
            .await
            .and_then(wreq::Response::error_for_status)
        {
            Ok(_) => {}
            Err(error) => {
                tracing::warn!("Event feed revalidation failed for school={school}: {error}")
            }
        }
    }
}
