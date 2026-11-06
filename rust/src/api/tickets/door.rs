//! The club's side at the door: admitting tickets, the door list with its
//! counts, and every event's tickets at a glance on the club's dashboard.

use std::collections::HashMap;

use chrono::Utc;
use sqlx::Row;
use uuid::Uuid;

use super::model::{
    CheckInResult, ClubEventTicketSummary, EventTicketDeskResponse, TicketAttendee,
    TicketCheckInResponse, TicketDateCounts, TicketRow, TicketStatus,
};
use super::ticketing::{managed_event, view};
use super::{codes, store};
use crate::api::AppState;
use crate::api::auth::User;
use crate::api::errors::ApiError;
use crate::api::messages::{TICKET_NOT_FOUND, TICKETS_NOT_AVAILABLE};
use crate::db::read_with_retry;

/// One ticket on the door list: the holder's full name and email, so the
/// club can find them when a phone will not scan.
pub fn attendee(ticket: &TicketRow) -> TicketAttendee {
    TicketAttendee {
        id: ticket.id,
        code: ticket.code.clone(),
        status: TicketStatus::from_db(&ticket.status),
        event_date_id: ticket.event_date_id,
        holder_name: ticket.holder_name(),
        holder_email: ticket.holder_email.clone(),
        issued_at: ticket.paid_at.unwrap_or(ticket.created_at),
        checked_in_at: ticket.checked_in_at,
        refunded_at: ticket.refunded_at,
        amount_cents: ticket.unit_amount_cents.unwrap_or(0),
        refund_requested_at: ticket.refund_requested_at,
        refund_request_note: ticket.refund_request_note.clone(),
        refund_declined_at: ticket.refund_declined_at,
    }
}

/// Admit a scanned or typed code, or undo an admission. A second scan of the
/// same ticket says when it was first admitted rather than admitting it twice.
pub async fn set_check_in(
    state: &AppState,
    event_id: i64,
    code: &str,
    checked_in: bool,
    manager: &User,
) -> Result<TicketCheckInResponse, ApiError> {
    managed_event(state, event_id, manager).await?;
    let Some(ticket) = store::ticket_by_code(&state.db, &codes::normalize(code)).await? else {
        return Ok(TicketCheckInResponse {
            result: CheckInResult::NotFound,
            attendee: None,
        });
    };
    if i64::from(ticket.event_id) != event_id {
        return Ok(TicketCheckInResponse {
            result: CheckInResult::NotForThisEvent,
            attendee: None,
        });
    }
    if !ticket.is_valid() {
        return Ok(TicketCheckInResponse {
            result: CheckInResult::Refunded,
            attendee: Some(attendee(&ticket)),
        });
    }
    let result = if checked_in {
        let admitted = sqlx::query(
            "UPDATE public.tickets SET checked_in_at = now(), checked_in_by = $2 \
             WHERE id = $1 AND checked_in_at IS NULL",
        )
        .bind(ticket.id)
        .bind(manager.id)
        .execute(&state.db)
        .await?
        .rows_affected();
        if admitted > 0 {
            CheckInResult::CheckedIn
        } else {
            CheckInResult::AlreadyCheckedIn
        }
    } else {
        sqlx::query(
            "UPDATE public.tickets SET checked_in_at = NULL, checked_in_by = NULL WHERE id = $1",
        )
        .bind(ticket.id)
        .execute(&state.db)
        .await?;
        CheckInResult::Undone
    };
    let updated = store::ticket_by_id(&state.db, ticket.id)
        .await?
        .ok_or_else(|| ApiError::not_found(TICKET_NOT_FOUND))?;
    Ok(TicketCheckInResponse {
        result,
        attendee: Some(attendee(&updated)),
    })
}

/// Counts per date and the whole door list for one event with tickets.
pub async fn desk(
    state: &AppState,
    event_id: i64,
    manager: &User,
) -> Result<EventTicketDeskResponse, ApiError> {
    let event = managed_event(state, event_id, manager).await?;
    let row = store::ticketing(&state.db, event_id)
        .await?
        .ok_or_else(|| ApiError::not_found(TICKETS_NOT_AVAILABLE))?;
    let ticketing = view(state, &event, &row, Utc::now()).await?;
    let tickets = store::tickets_for_event(&state.db, event_id).await?;
    let mut issued: HashMap<Uuid, i64> = HashMap::new();
    let mut admitted: HashMap<Uuid, i64> = HashMap::new();
    let mut revenue_cents = 0;
    for ticket in tickets.iter().filter(|ticket| ticket.is_valid()) {
        *issued.entry(ticket.event_date_id).or_default() += 1;
        if ticket.checked_in_at.is_some() {
            *admitted.entry(ticket.event_date_id).or_default() += 1;
        }
        revenue_cents += i64::from(ticket.unit_amount_cents.unwrap_or(0));
    }
    let remaining: HashMap<Uuid, Option<i64>> = ticketing
        .dates
        .iter()
        .map(|date| (date.event_date_id, date.remaining))
        .collect();
    let valid = issued.values().sum();
    Ok(EventTicketDeskResponse {
        issued: valid,
        checked_in: admitted.values().sum(),
        refunded: tickets.len() as i64 - valid,
        revenue_cents,
        dates: event
            .occurrences
            .iter()
            .map(|occurrence| TicketDateCounts {
                event_date_id: occurrence.id,
                dtstart_utc: occurrence.dtstart_utc,
                issued: issued.get(&occurrence.id).copied().unwrap_or(0),
                checked_in: admitted.get(&occurrence.id).copied().unwrap_or(0),
                remaining: remaining.get(&occurrence.id).copied().flatten(),
            })
            .collect(),
        // Holders waiting on a refund answer come first, so a request never sits unseen.
        attendees: {
            let mut attendees: Vec<TicketAttendee> = tickets.iter().map(attendee).collect();
            attendees.sort_by_key(|attendee| {
                !(attendee.status == TicketStatus::Valid
                    && attendee.refund_requested_at.is_some()
                    && attendee.refund_declined_at.is_none())
            });
            attendees
        },
        ticketing,
    })
}

/// Every event of the club that has tickets, with its counts, for its dashboard.
pub async fn club_summaries(
    state: &AppState,
    club_id: i64,
) -> Result<Vec<ClubEventTicketSummary>, ApiError> {
    let rows = read_with_retry(|| {
        sqlx::query(
            "SELECT et.event_id::int8 AS event_id, et.price_cents, et.currency, et.capacity, et.paused, \
                    count(t.id) FILTER (WHERE t.status = 'valid') AS issued, \
                    count(t.id) FILTER (WHERE t.status = 'valid' AND t.checked_in_at IS NOT NULL) AS checked_in, \
                    coalesce(sum(o.unit_amount_cents) FILTER (WHERE t.status = 'valid'), 0)::int8 AS revenue_cents, \
                    count(t.id) FILTER (WHERE t.status = 'valid' AND t.refund_requested_at IS NOT NULL \
                                        AND t.refund_declined_at IS NULL) AS refund_requests \
             FROM public.event_ticketing et \
             JOIN public.events e ON e.id = et.event_id \
             LEFT JOIN public.tickets t ON t.event_id = et.event_id \
             LEFT JOIN public.ticket_orders o ON o.id = t.order_id \
             WHERE e.club_id = $1 \
             GROUP BY et.event_id ORDER BY et.event_id",
        )
        .bind(club_id)
        .fetch_all(&state.db)
    })
    .await?;
    rows.iter()
        .map(|row| {
            Ok(ClubEventTicketSummary {
                event_id: row.try_get("event_id")?,
                price_cents: row.try_get("price_cents")?,
                currency: row.try_get("currency")?,
                capacity: row.try_get("capacity")?,
                paused: row.try_get("paused")?,
                issued: row.try_get("issued")?,
                checked_in: row.try_get("checked_in")?,
                revenue_cents: row.try_get("revenue_cents")?,
                refund_requests: row.try_get("refund_requests")?,
            })
        })
        .collect::<Result<_, sqlx::Error>>()
        .map_err(ApiError::from)
}
