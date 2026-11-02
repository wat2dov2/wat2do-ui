//! `GET /ingestion-latency/`: how long events take to reach wat2do after
//! their Instagram post goes up (`routers/ingestion_latency.py`,
//! `services/ingestion_latency_service.py`). Admin only.

use std::collections::BTreeMap;

use axum::Json;
use axum::extract::State;
use chrono::{DateTime, Duration, DurationRound, Utc};
use serde::Serialize;
use utoipa::ToSchema;

use crate::api::AppState;
use crate::api::auth::AdminUser;
use crate::api::errors::ApiError;
use crate::api::json;
use crate::api::validation::{Limits, QueryParams, Validator};
use crate::db::read_with_retry;

#[derive(Debug, PartialEq, Serialize, ToSchema)]
pub struct LatencyStats {
    pub count: i64,
    #[schema(required = true)]
    #[serde(serialize_with = "json::option_float")]
    pub mean_minutes: Option<f64>,
    #[schema(required = true)]
    #[serde(serialize_with = "json::option_float")]
    pub median_minutes: Option<f64>,
}

#[derive(Debug, PartialEq, Serialize, ToSchema)]
pub struct SchoolIngestionLatency {
    pub count: i64,
    #[schema(required = true)]
    #[serde(serialize_with = "json::option_float")]
    pub mean_minutes: Option<f64>,
    #[schema(required = true)]
    #[serde(serialize_with = "json::option_float")]
    pub median_minutes: Option<f64>,
    pub school: String,
}

#[derive(Debug, PartialEq, Serialize, ToSchema)]
pub struct HourlyIngestionLatency {
    #[schema(value_type = String, format = DateTime)]
    #[serde(serialize_with = "json::datetime")]
    pub hour: DateTime<Utc>,
    pub count: i64,
    #[serde(serialize_with = "json::float")]
    pub mean_minutes: f64,
    #[serde(serialize_with = "json::float")]
    pub median_minutes: f64,
}

#[derive(Debug, PartialEq, Serialize, ToSchema)]
pub struct IngestionLatencyResponse {
    #[schema(value_type = String, format = DateTime)]
    #[serde(serialize_with = "json::datetime")]
    pub since: DateTime<Utc>,
    pub overall: LatencyStats,
    pub schools: Vec<SchoolIngestionLatency>,
    pub hourly: Vec<HourlyIngestionLatency>,
}

/// Python's `math.fsum`: the correctly rounded sum (Shewchuk's partials).
fn fsum(values: &[f64]) -> f64 {
    let mut partials: Vec<f64> = Vec::new();
    for &value in values {
        let mut x = value;
        let mut kept = 0;
        for index in 0..partials.len() {
            let mut y = partials[index];
            if x.abs() < y.abs() {
                std::mem::swap(&mut x, &mut y);
            }
            let high = x + y;
            let low = y - (high - x);
            if low != 0.0 {
                partials[kept] = low;
                kept += 1;
            }
            x = high;
        }
        partials.truncate(kept);
        partials.push(x);
    }
    // Sum from the top, correcting the final half-way rounding as CPython does.
    let Some(mut high) = partials.pop() else {
        return 0.0;
    };
    let mut low = 0.0;
    while let Some(y) = partials.pop() {
        let x = high;
        high = x + y;
        let y_rounded = high - x;
        low = y - y_rounded;
        if low != 0.0 {
            break;
        }
    }
    if let Some(&next) = partials.last()
        && ((low < 0.0 && next < 0.0) || (low > 0.0 && next > 0.0))
    {
        let y = low * 2.0;
        let x = high + y;
        if y == x - high {
            high = x;
        }
    }
    high
}

/// `statistics.fmean`.
fn fmean(values: &[f64]) -> f64 {
    fsum(values) / values.len() as f64
}

/// `statistics.median`: the middle value, or the mean of the middle two.
fn median(values: &[f64]) -> f64 {
    let mut sorted = values.to_vec();
    sorted.sort_by(f64::total_cmp);
    let middle = sorted.len() / 2;
    if sorted.len() % 2 == 1 {
        sorted[middle]
    } else {
        (sorted[middle - 1] + sorted[middle]) / 2.0
    }
}

fn stats(values: &[f64]) -> LatencyStats {
    LatencyStats {
        count: values.len() as i64,
        mean_minutes: (!values.is_empty()).then(|| fmean(values)),
        median_minutes: (!values.is_empty()).then(|| median(values)),
    }
}

/// One `ingestion_latencies` row: the school, when the event was added, and
/// how long after its post.
struct Latency {
    school: String,
    added_at: Option<DateTime<Utc>>,
    latency_seconds: f64,
}

/// `get_report`: mean and median delay overall, per school and per hour.
fn report(since: DateTime<Utc>, rows: Vec<Latency>) -> IngestionLatencyResponse {
    let mut overall = Vec::with_capacity(rows.len());
    let mut by_school: BTreeMap<String, Vec<f64>> = BTreeMap::new();
    let mut by_hour: BTreeMap<DateTime<Utc>, Vec<f64>> = BTreeMap::new();
    for row in rows {
        let minutes = row.latency_seconds / 60.0;
        overall.push(minutes);
        by_school.entry(row.school).or_default().push(minutes);
        if let Some(added_at) = row.added_at {
            let hour = added_at
                .duration_trunc(Duration::hours(1))
                .unwrap_or(added_at);
            by_hour.entry(hour).or_default().push(minutes);
        }
    }
    IngestionLatencyResponse {
        since,
        overall: stats(&overall),
        schools: by_school
            .into_iter()
            .map(|(school, values)| {
                let LatencyStats {
                    count,
                    mean_minutes,
                    median_minutes,
                } = stats(&values);
                SchoolIngestionLatency {
                    count,
                    mean_minutes,
                    median_minutes,
                    school,
                }
            })
            .collect(),
        hourly: by_hour
            .into_iter()
            .map(|(hour, values)| HourlyIngestionLatency {
                hour,
                count: values.len() as i64,
                mean_minutes: fmean(&values),
                median_minutes: median(&values),
            })
            .collect(),
    }
}

#[utoipa::path(
    get,
    path = "/ingestion-latency/",
    tag = "ingestion-latency",
    operation_id = "get_ingestion_latency_ingestion_latency__get",
    summary = "Get Ingestion Latency",
    description = "Delay between an Instagram post and its event being added to wat2do.",
    params(("days" = Option<i64>, Query, minimum = 1, maximum = 30)),
    responses(
        (status = 200, description = "Successful Response", body = IngestionLatencyResponse),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn get_ingestion_latency(
    State(state): State<AppState>,
    AdminUser(_): AdminUser,
    query: QueryParams,
) -> Result<Json<IngestionLatencyResponse>, ApiError> {
    let mut check = Validator::default();
    let days = check
        .query(&query, "days")
        .int_or(7, Limits::default().ge(1).le(30));
    check.finish()?;
    let since = Utc::now() - Duration::days(days);
    // Every row of the window. (PostgREST cut the RPC's answer at its
    // 1000-row limit, so Python summarised an arbitrary subset of busy weeks.)
    let rows = read_with_retry(|| {
        sqlx::query_as::<_, (String, Option<DateTime<Utc>>, f64)>(
            "SELECT school, added_at, latency_seconds FROM public.ingestion_latencies($1)",
        )
        .bind(since)
        .fetch_all(&state.db)
    })
    .await?;
    let rows = rows
        .into_iter()
        .map(|(school, added_at, latency_seconds)| Latency {
            school,
            added_at,
            latency_seconds,
        })
        .collect();
    Ok(Json(report(since, rows)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn at(hour: u32, minute: u32) -> Option<DateTime<Utc>> {
        Some(Utc.with_ymd_and_hms(2026, 10, 10, hour, minute, 0).unwrap())
    }

    #[test]
    fn report_breaks_delays_down_by_school_and_hour() {
        // backend/tests/services/test_ingestion_latency_service.py
        let rows = vec![
            Latency { school: "uwaterloo".into(), added_at: at(14, 5), latency_seconds: 600.0 },
            Latency { school: "uwaterloo".into(), added_at: at(14, 40), latency_seconds: 1800.0 },
            Latency { school: "mcgill".into(), added_at: at(15, 20), latency_seconds: 3600.0 },
        ];
        let since = Utc.with_ymd_and_hms(2026, 10, 3, 0, 0, 0).unwrap();
        let report = report(since, rows);
        assert_eq!(report.overall.count, 3);
        assert_eq!(report.overall.mean_minutes, Some(fsum(&[10.0, 30.0, 60.0]) / 3.0));
        assert_eq!(report.overall.median_minutes, Some(30.0));
        assert_eq!(
            report.schools.iter().map(|s| s.school.as_str()).collect::<Vec<_>>(),
            ["mcgill", "uwaterloo"]
        );
        let waterloo = &report.schools[1];
        assert_eq!((waterloo.count, waterloo.mean_minutes, waterloo.median_minutes), (2, Some(20.0), Some(20.0)));
        let hourly: Vec<_> = report
            .hourly
            .iter()
            .map(|hour| (hour.hour, hour.count, hour.median_minutes))
            .collect();
        assert_eq!(hourly, [(at(14, 0).unwrap(), 2, 20.0), (at(15, 0).unwrap(), 1, 60.0)]);
        let body = serde_json::to_string(&report).unwrap();
        assert!(body.starts_with(r#"{"since":"2026-10-03T00:00:00Z","overall":{"count":3,"mean_minutes":33.333333333333336,"median_minutes":30.0}"#));
        assert!(body.contains(r#"{"hour":"2026-10-10T14:00:00Z","count":2,"mean_minutes":20.0,"median_minutes":20.0}"#));
    }

    #[test]
    fn report_without_events_is_empty() {
        let report = report(Utc::now(), Vec::new());
        assert_eq!(report.overall, LatencyStats { count: 0, mean_minutes: None, median_minutes: None });
        assert!(report.schools.is_empty() && report.hourly.is_empty());
        assert!(serde_json::to_string(&report.overall).unwrap().ends_with(r#""mean_minutes":null,"median_minutes":null}"#));
    }

    #[test]
    fn fsum_is_correctly_rounded_like_python() {
        // math.fsum([0.1] * 10) == 1.0 while the naive sum is 0.9999999999999999.
        assert_eq!(fsum(&[0.1; 10]), 1.0);
        assert_eq!(fsum(&[1e100, 1.0, -1e100, 1e-100, 1e50, -1.0, -1e50]), 1e-100);
        assert_eq!(fsum(&[]), 0.0);
        assert_eq!(median(&[3.0, 1.0, 2.0, 10.0]), 2.5);
    }
}
