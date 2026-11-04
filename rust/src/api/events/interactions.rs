//! Event and position interactions (`interaction_service.record_interactions_batch`):
//! ownership checks, anonymous restrictions, per-window caps, then inserts.

use std::collections::HashMap;

use chrono::Utc;
use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

use super::requests::InteractionInput;
use crate::api::errors::ApiError;
use crate::controlbox::INTERACTION_INGESTION;

/// Anonymous callers may record only clicks and un-goings: these feed
/// popularity and collaborative scores.
const ANONYMOUS_DISALLOWED: [&str; 3] = ["going", "share", "detail_view"];
/// `INTERACTION_CLICK`.
const CLICK: &str = "click";
const ON_BEHALF: &str = "Cannot submit interactions on behalf of another user";

/// Who a batch is recorded for.
#[derive(Debug, Clone, Copy)]
pub enum Actor<'a> {
    User(Uuid),
    Session(&'a str),
}

/// `_validate_batch`: the payload's `user_id` must be the signed-in user.
pub fn check_owner(user_id: Option<Uuid>, payload_user_id: Option<Uuid>) -> Result<(), ApiError> {
    match (payload_user_id, user_id) {
        (None, _) => Ok(()),
        (Some(_), None) => Err(ApiError::authentication(ON_BEHALF)),
        (Some(claimed), Some(user)) if claimed != user => Err(ApiError::authorization(ON_BEHALF)),
        _ => Ok(()),
    }
}

fn target(item: &InteractionInput, position: bool) -> i64 {
    if position {
        item.position_id.unwrap_or_default()
    } else {
        item.event_id.unwrap_or_default()
    }
}

/// `_filter_duplicate_interactions`: the per target-and-type cap and the
/// window's total cap, counting the items accepted from this batch.
pub fn filter_duplicates(
    existing: &[(i64, String)],
    interactions: Vec<InteractionInput>,
    actor: &str,
    position: bool,
    caps: (usize, usize),
) -> Vec<InteractionInput> {
    let (maximum_duplicates, maximum_total) = caps;
    let mut counts: HashMap<(i64, String), usize> = HashMap::new();
    for key in existing {
        *counts.entry(key.clone()).or_default() += 1;
    }
    let mut total = existing.len();
    let mut kept = Vec::new();
    for item in interactions {
        let event = item.event_id.map_or("None".to_owned(), |id| id.to_string());
        if total >= maximum_total {
            tracing::warn!(
                "Dropping interaction {actor} event={event} type={} - global cap reached ({total}/{maximum_total})",
                item.interaction_type
            );
            continue;
        }
        let key = (target(&item, position), item.interaction_type.clone());
        let count = counts.get(&key).copied().unwrap_or_default();
        if count >= maximum_duplicates {
            tracing::warn!(
                "Dropping duplicate interaction {actor} event={event} type={} (count={count})",
                item.interaction_type
            );
            continue;
        }
        *counts.entry(key).or_default() += 1;
        total += 1;
        kept.push(item);
    }
    kept
}

/// The actor's interactions in the dedup window, one table's worth.
async fn recent(
    db: &PgPool,
    actor: Actor<'_>,
    position: bool,
) -> Result<Vec<(i64, String)>, sqlx::Error> {
    let (table, column) = if position {
        ("position_interactions", "position_id")
    } else {
        ("user_interactions", "event_id")
    };
    let cutoff =
        Utc::now() - chrono::Duration::minutes(INTERACTION_INGESTION.deduplication_window_minutes);
    let who = match actor {
        Actor::User(_) => "user_id = $1",
        Actor::Session(_) => "session_id = $1 AND user_id IS NULL",
    };
    let sql = format!(
        "SELECT {column}::int8, interaction_type FROM public.{table} WHERE {who} AND created_at >= $2"
    );
    crate::db::read_with_retry(|| {
        let query = sqlx::query_as::<_, (i64, String)>(&sql);
        let query = match actor {
            Actor::User(id) => query.bind(id),
            Actor::Session(session) => query.bind(session.to_owned()),
        };
        query.bind(cutoff).fetch_all(db)
    })
    .await
}

/// `check_duplicate_interactions` / `_for_session`: a failed read rejects the group.
async fn without_duplicates(
    db: &PgPool,
    actor: Actor<'_>,
    interactions: Vec<InteractionInput>,
    position: bool,
) -> Vec<InteractionInput> {
    if interactions.is_empty() {
        return interactions;
    }
    let (label, failure) = match actor {
        Actor::User(id) => (
            format!("user={id}"),
            "Dedup check failed, rejecting batch to prevent gaming",
        ),
        Actor::Session(session) => (
            format!("anonymous session={session}"),
            "Anonymous dedup check failed, rejecting batch",
        ),
    };
    match recent(db, actor, position).await {
        Ok(existing) => filter_duplicates(
            &existing,
            interactions,
            &label,
            position,
            (
                INTERACTION_INGESTION.maximum_duplicates_per_window,
                INTERACTION_INGESTION.maximum_user_interactions_per_window,
            ),
        ),
        Err(error) => {
            tracing::error!("{failure}: {error}");
            Vec::new()
        }
    }
}

/// `check_click_burst_for_ip`'s cap on counted clicks: each item keeps its
/// place; a click whose target already has `maximum` anonymous clicks from
/// this IP in the window is dropped, and kept clicks count toward the cap.
pub fn cap_clicks_per_ip(
    existing: &[i64],
    interactions: Vec<InteractionInput>,
    ip_hash: &str,
    position: bool,
    maximum: usize,
) -> Vec<InteractionInput> {
    let mut counts: HashMap<i64, usize> = HashMap::new();
    for target in existing {
        *counts.entry(*target).or_default() += 1;
    }
    let field = if position { "position_id" } else { "event_id" };
    let prefix: String = ip_hash.chars().take(12).collect();
    let mut kept = Vec::new();
    for item in interactions {
        if item.interaction_type != CLICK {
            kept.push(item);
            continue;
        }
        let key = target(&item, position);
        let count = counts.entry(key).or_default();
        if *count >= maximum {
            tracing::warn!(
                "Dropping anonymous click - IP+event cap reached (ip_hash={prefix}\u{2026} {field}={key} count={count})"
            );
            continue;
        }
        *count += 1;
        kept.push(item);
    }
    kept
}

/// `check_click_burst_for_ip`: cap anonymous clicks per client IP and target
/// within the dedup window, since a fresh `session_id` per request gets past
/// the per-session cap. Only clicks are limited; a failed read rejects the
/// group (fail closed), as the session checks do.
async fn without_click_bursts(
    db: &PgPool,
    ip_hash: &str,
    interactions: Vec<InteractionInput>,
    position: bool,
) -> Vec<InteractionInput> {
    if !interactions
        .iter()
        .any(|item| item.interaction_type == CLICK)
    {
        return interactions;
    }
    let (table, column) = if position {
        ("position_interactions", "position_id")
    } else {
        ("user_interactions", "event_id")
    };
    let cutoff =
        Utc::now() - chrono::Duration::minutes(INTERACTION_INGESTION.deduplication_window_minutes);
    let sql = format!(
        "SELECT {column}::int8 FROM public.{table} \
         WHERE ip_hash = $1 AND interaction_type = 'click' AND user_id IS NULL AND created_at >= $2"
    );
    let existing = crate::db::read_with_retry(|| {
        sqlx::query_scalar::<_, i64>(&sql)
            .bind(ip_hash)
            .bind(cutoff)
            .fetch_all(db)
    })
    .await;
    match existing {
        Ok(existing) => cap_clicks_per_ip(
            &existing,
            interactions,
            ip_hash,
            position,
            INTERACTION_INGESTION.maximum_anonymous_clicks_per_ip_per_event,
        ),
        Err(error) => {
            tracing::error!("Anonymous IP click-burst check failed, rejecting batch: {error}");
            Vec::new()
        }
    }
}

/// `record_interactions_batch`: returns how many rows were recorded.
/// `ip_hash` is the caller's hashed client IP when the hashing secret is set.
pub async fn record_batch(
    db: &PgPool,
    user_id: Option<Uuid>,
    payload_user_id: Option<Uuid>,
    session_id: &str,
    interactions: Vec<InteractionInput>,
    ip_hash: Option<&str>,
) -> Result<i64, ApiError> {
    check_owner(user_id, payload_user_id)?;
    let (actor, mut interactions) = match user_id {
        Some(id) => (Actor::User(id), interactions),
        None => {
            let total = interactions.len();
            let kept: Vec<InteractionInput> = interactions
                .into_iter()
                .filter(|item| !ANONYMOUS_DISALLOWED.contains(&item.interaction_type.as_str()))
                .collect();
            let dropped = total - kept.len();
            if dropped > 0 {
                tracing::warn!(
                    "Dropped {dropped} anonymous interactions of restricted types (session={session_id})"
                );
            }
            if kept.is_empty() {
                return Ok(0);
            }
            (Actor::Session(session_id), kept)
        }
    };
    let (positions, events): (Vec<_>, Vec<_>) = interactions
        .drain(..)
        .partition(|item| item.position_id.is_some());
    let mut events = without_duplicates(db, actor, events, false).await;
    let mut positions = without_duplicates(db, actor, positions, true).await;
    if let (Actor::Session(_), Some(ip_hash)) = (actor, ip_hash) {
        events = without_click_bursts(db, ip_hash, events, false).await;
        positions = without_click_bursts(db, ip_hash, positions, true).await;
    }
    events.extend(positions);
    if events.is_empty() {
        return Ok(0);
    }
    record(db, user_id, session_id, &events, ip_hash).await
}

/// `record_interactions`: insert each table's rows, events first.
async fn record(
    db: &PgPool,
    user_id: Option<Uuid>,
    session_id: &str,
    interactions: &[InteractionInput],
    ip_hash: Option<&str>,
) -> Result<i64, ApiError> {
    // Both tables or neither, even if the request is dropped between them.
    let mut transaction = db.begin().await?;
    let mut recorded = 0;
    for position in [false, true] {
        let rows: Vec<&InteractionInput> = interactions
            .iter()
            .filter(|item| item.position_id.is_some() == position)
            .collect();
        if rows.is_empty() {
            continue;
        }
        let (table, column) = if position {
            ("position_interactions", "position_id")
        } else {
            ("user_interactions", "event_id")
        };
        let ids: Vec<Uuid> = rows.iter().map(|_| Uuid::new_v4()).collect();
        let targets: Vec<i64> = rows.iter().map(|item| target(item, position)).collect();
        let kinds: Vec<String> = rows
            .iter()
            .map(|item| item.interaction_type.clone())
            .collect();
        let metadata: Vec<Value> = rows
            .iter()
            .map(|item| item.metadata.clone().unwrap_or(Value::Null))
            .collect();
        let inserted = sqlx::query(&format!(
            "INSERT INTO public.{table} \
             (id, user_id, session_id, {column}, interaction_type, metadata, ip_hash) \
             SELECT id, $2, $3, target::int4, kind, NULLIF(metadata, 'null'::jsonb), $7 \
             FROM unnest($1::uuid[], $4::int8[], $5::text[], $6::jsonb[]) AS row(id, target, kind, metadata)"
        ))
        .bind(&ids)
        .bind(user_id)
        .bind(session_id)
        .bind(&targets)
        .bind(&kinds)
        .bind(&metadata)
        .bind(ip_hash)
        .execute(&mut *transaction)
        .await?;
        recorded += inserted.rows_affected() as i64;
    }
    transaction.commit().await?;
    Ok(recorded)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn click(event_id: i64) -> InteractionInput {
        InteractionInput {
            event_id: Some(event_id),
            position_id: None,
            interaction_type: "click".into(),
            metadata: None,
        }
    }

    #[test]
    fn payload_user_must_be_the_signed_in_user() {
        let (me, other) = (Uuid::from_u128(1), Uuid::from_u128(99));
        assert!(check_owner(Some(me), Some(me)).is_ok());
        assert!(check_owner(Some(me), None).is_ok());
        assert!(check_owner(None, None).is_ok());
        assert!(
            matches!(check_owner(None, Some(me)), Err(ApiError::Authentication(d)) if d == ON_BEHALF)
        );
        assert!(
            matches!(check_owner(Some(me), Some(other)), Err(ApiError::Authorization(d)) if d == ON_BEHALF)
        );
    }

    #[test]
    fn caps_preserve_order() {
        // test_interaction_caps_preserve_order_and_actor_scope (caps 2 and 5)
        let kind = |event_id: i64, kind: &str| InteractionInput {
            event_id: Some(event_id),
            position_id: None,
            interaction_type: kind.into(),
            metadata: None,
        };
        let batch = vec![
            kind(1, "click"),
            kind(1, "click"),
            kind(1, "click"),
            kind(1, "share"),
            kind(2, "click"),
            kind(3, "click"),
        ];
        let pairs = |pairs: &[(i64, &str)]| {
            pairs
                .iter()
                .map(|(id, kind)| (*id, (*kind).to_owned()))
                .collect::<Vec<_>>()
        };
        for (existing, expected) in [
            (pairs(&[]), vec![0, 1, 3, 4, 5]),
            (pairs(&[(1, "click")]), vec![0, 3, 4, 5]),
            (pairs(&[(1, "click"); 2]), vec![3, 4, 5]),
            (pairs(&[(9, "click"); 4]), vec![0]),
            (pairs(&[(9, "click"); 5]), vec![]),
            (
                pairs(&[(1, "click"), (1, "click"), (1, "share"), (1, "share")]),
                vec![4],
            ),
        ] {
            let kept = filter_duplicates(&existing, batch.clone(), "user=actor-1", false, (2, 5));
            let wanted: Vec<InteractionInput> =
                expected.iter().map(|index| batch[*index].clone()).collect();
            assert_eq!(kept, wanted, "{existing:?}");
        }
        // Later pages of history count too (test_interaction_dedup_includes_history_from_later_pages).
        let mut history: Vec<(i64, String)> =
            (2..1002).map(|id| (id, "click".to_owned())).collect();
        history.push((1, "click".to_owned()));
        assert!(filter_duplicates(&history, vec![click(1)], "user=x", false, (1, 2000)).is_empty());
    }

    #[test]
    fn anonymous_clicks_are_capped_per_ip_and_target() {
        // test_click_burst_caps_anonymous_clicks_per_ip (cap 2)
        let ungoing = InteractionInput {
            event_id: Some(4),
            position_id: None,
            interaction_type: "ungoing".into(),
            metadata: None,
        };
        let batch = vec![click(1), click(2), click(3), ungoing];
        for (existing, expected) in [
            (vec![], vec![0, 1, 2, 3]),
            (vec![1, 1], vec![1, 2, 3]),
            (vec![1, 1, 2, 2], vec![2, 3]),
        ] {
            let kept = cap_clicks_per_ip(&existing, batch.clone(), "iphash", false, 2);
            let wanted: Vec<InteractionInput> =
                expected.iter().map(|index| batch[*index].clone()).collect();
            assert_eq!(kept, wanted, "{existing:?}");
        }
        // Clicks accepted from this batch count toward the cap.
        let kept = cap_clicks_per_ip(&[1], vec![click(1), click(1), click(1)], "iphash", false, 2);
        assert_eq!(kept, vec![click(1)]);
    }
}
