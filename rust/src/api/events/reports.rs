//! Reported events (`report_service.py`).

use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::PgPool;
use uuid::Uuid;

use crate::api::errors::ApiError;
use crate::api::messages::INVALID_STATUS_TRANSITION;
use crate::api::pagination::Pagination;
use crate::api::pyjson::PyDateTime;
use crate::db::read_with_retry;

/// `ReportResponse`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Report {
    pub event_title: Option<String>,
    pub school: Option<String>,
    pub id: String,
    pub event_id: i64,
    pub user_id: Option<String>,
    pub reason: String,
    pub status: String,
    pub reported_at: PyDateTime,
    pub resolved_at: Option<PyDateTime>,
}

type ReportRow = (
    String,
    i64,
    Option<String>,
    String,
    String,
    DateTime<Utc>,
    Option<DateTime<Utc>>,
);

const RETURNING: &str =
    "id::text, event_id::int8, user_id::text, reason, status::text, reported_at, resolved_at";

fn report(
    row: ReportRow,
    event_title: Option<String>,
    school: Option<String>,
) -> Result<Report, ApiError> {
    let (id, event_id, user_id, reason, status, reported_at, resolved_at) = row;
    if !["pending", "resolved", "dismissed"].contains(&status.as_str()) {
        return Err(ApiError::Internal(anyhow::anyhow!(
            "report {id} has status {status:?}"
        )));
    }
    Ok(Report {
        event_title,
        school,
        id,
        event_id,
        user_id,
        reason,
        status,
        reported_at: reported_at.into(),
        resolved_at: resolved_at.map(Into::into),
    })
}

/// `create_report`'s insert, once the event is known to exist.
pub async fn create(
    db: &PgPool,
    user_id: Option<Uuid>,
    event_id: i64,
    reason: &str,
) -> Result<Report, ApiError> {
    let row: ReportRow = sqlx::query_as(&format!(
        "INSERT INTO public.reported_events (id, event_id, user_id, reason, status) \
         VALUES ($1, $2, $3, $4, 'pending') RETURNING {RETURNING}"
    ))
    .bind(Uuid::new_v4())
    .bind(event_id as i32)
    .bind(user_id)
    .bind(reason)
    .fetch_one(db)
    .await?;
    report(row, None, None)
}

/// `get_reports`: one admin page of reports with their event's title and school.
pub async fn page(
    db: &PgPool,
    pagination: Pagination,
    status: Option<&str>,
    search: Option<&str>,
    school: Option<&str>,
) -> Result<(Vec<Report>, i64), ApiError> {
    let (conditions, values) = super::store::admin_conditions(search, school, status, None);
    let offset = format!("${}", values.len() + 2);
    let limit = format!("${}", values.len() + 3);
    let sql = format!(
        "WITH {} SELECT (SELECT count(*) FROM entries), \
         COALESCE((SELECT json_agg(json_build_array(r.id::text, r.event_id, r.user_id::text, r.reason, r.status, \
         (extract(epoch FROM r.reported_at) * 1000000)::int8, (extract(epoch FROM r.resolved_at) * 1000000)::int8, \
         e.title, CASE WHEN e.id IS NULL THEN NULL ELSE NULLIF(s.slug, '') END) ORDER BY p.ord) \
         FROM page_entries p JOIN public.reported_events r ON r.id = p.id::uuid \
         LEFT JOIN public.events e ON e.id = r.event_id LEFT JOIN public.schools s ON s.id = e.school_id), '[]')",
        super::store::admin_page_ctes(&conditions, &offset, &limit)
    );
    let (total, rows): (i64, serde_json::Value) = read_with_retry(|| {
        let mut query = sqlx::query_as(&sql).bind("reports");
        for value in &values {
            query = query.bind(value.as_str());
        }
        query
            .bind(pagination.offset())
            .bind(pagination.page_size)
            .fetch_one(db)
    })
    .await?;
    type Json = (
        String,
        i64,
        Option<String>,
        String,
        String,
        i64,
        Option<i64>,
        Option<String>,
        Option<String>,
    );
    let rows: Vec<Json> = serde_json::from_value(rows)
        .map_err(|error| ApiError::Internal(anyhow::anyhow!("reports JSON: {error}")))?;
    let micros = |value: i64| {
        DateTime::from_timestamp_micros(value)
            .ok_or_else(|| ApiError::Internal(anyhow::anyhow!("timestamp out of range")))
    };
    let reports = rows
        .into_iter()
        .map(
            |(id, event_id, user_id, reason, status, reported_at, resolved_at, title, school)| {
                let row = (
                    id,
                    event_id,
                    user_id,
                    reason,
                    status,
                    micros(reported_at)?,
                    resolved_at.map(micros).transpose()?,
                );
                report(row, title, school)
            },
        )
        .collect::<Result<Vec<_>, _>>()?;
    Ok((reports, total))
}

/// `_ALLOWED_TRANSITIONS`: only a pending report moves, and only forward.
fn allowed(from: &str, to: &str) -> bool {
    from == to || (from == "pending" && matches!(to, "resolved" | "dismissed"))
}

/// `update_report`: `None` when the report does not exist.
pub async fn update(
    db: &PgPool,
    report_id: &str,
    status: &str,
) -> Result<Option<Report>, ApiError> {
    let select = format!("SELECT {RETURNING} FROM public.reported_events WHERE id = $1::uuid");
    let existing: Option<ReportRow> =
        read_with_retry(|| sqlx::query_as(&select).bind(report_id).fetch_optional(db)).await?;
    let Some(existing) = existing else {
        return Ok(None);
    };
    let current = existing.4.clone();
    if !allowed(&current, status) {
        let mut options: Vec<&str> = match current.as_str() {
            "pending" => vec!["resolved", "dismissed"],
            _ => vec![],
        };
        options.sort_unstable();
        tracing::warn!(
            "Rejected report transition {report_id}: {current} -> {status} (allowed: {options:?})"
        );
        return Err(ApiError::validation(INVALID_STATUS_TRANSITION));
    }
    // `resolved_at` is stamped once, when a report first leaves pending.
    let stamp = current == "pending" && status != "pending";
    let row: Option<ReportRow> = sqlx::query_as(&format!(
        "UPDATE public.reported_events SET status = $2, \
         resolved_at = CASE WHEN $3 THEN now() ELSE resolved_at END \
         WHERE id = $1::uuid RETURNING {RETURNING}"
    ))
    .bind(report_id)
    .bind(status)
    .bind(stamp)
    .fetch_optional(db)
    .await?;
    row.map(|row| report(row, None, None)).transpose()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_pending_reports_move_forward() {
        // tests/routers/test_reports.py transition cases
        assert!(allowed("pending", "resolved"));
        assert!(allowed("pending", "dismissed"));
        assert!(allowed("resolved", "resolved"));
        assert!(!allowed("resolved", "pending"));
        assert!(!allowed("dismissed", "resolved"));
        assert!(allowed("pending", "pending"));
    }
}
