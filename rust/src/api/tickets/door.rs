//! The club's side at the door: admitting tickets, the door list with its
//! counts, and every event's tickets at a glance on the club's dashboard.

use std::collections::HashMap;

use chrono::{DateTime, Duration, Utc};
use sqlx::Row;
use uuid::Uuid;

use super::model::{
    CheckInResult, ClubEventTicketSummary, EventTicketDeskResponse, TicketAttendee,
    TicketCheckInResponse, TicketDateCounts, TicketRow, TicketStatus, TicketTierCounts,
};
use super::ticketing::{closes_at, managed_event, view};
use super::{codes, store};
use crate::api::AppState;
use crate::api::auth::User;
use crate::api::errors::ApiError;
use crate::api::events::model::Event;
use crate::api::messages::{TICKET_NOT_FOUND, TICKETS_NOT_AVAILABLE};
use crate::controlbox::TICKETING;
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
        tier_name: ticket.tier_name.clone(),
        issued_at: ticket.paid_at.unwrap_or(ticket.created_at),
        checked_in_at: ticket.checked_in_at,
        refunded_at: ticket.refunded_at,
        amount_cents: ticket.unit_amount_cents.unwrap_or(0),
        refund_requested_at: ticket.refund_requested_at,
        refund_request_note: ticket.refund_request_note.clone(),
        refund_declined_at: ticket.refund_declined_at,
    }
}

/// The date the door admits tickets to at `now`: of the event's dates open at
/// the door (from `check_in_opens_hours_before` their start until
/// `check_in_closes_hours_after` their end), the one closest to `now`, so a
/// ticket to a later session the same day still waits its turn.
pub fn door_date(event: &Event, now: DateTime<Utc>) -> Option<Uuid> {
    event
        .occurrences
        .iter()
        .filter_map(|occurrence| {
            let (start, end) = (occurrence.dtstart_utc, closes_at(occurrence));
            let opens = start - Duration::hours(TICKETING.check_in_opens_hours_before);
            let closes = end + Duration::hours(TICKETING.check_in_closes_hours_after);
            if now < opens || now > closes {
                return None;
            }
            let distance = if now < start {
                start - now
            } else {
                (now - end).max(Duration::zero())
            };
            Some((distance, occurrence.id))
        })
        .min_by_key(|(distance, _)| *distance)
        .map(|(_, id)| id)
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
    let event = managed_event(state, event_id, manager).await?;
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
    if checked_in && door_date(&event, Utc::now()) != Some(ticket.event_date_id) {
        return Ok(TicketCheckInResponse {
            result: CheckInResult::WrongDate,
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

/// Counts per tier and date, and the whole door list, for one event with tickets.
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
    let mut tiers: HashMap<Uuid, TicketTierCounts> = HashMap::new();
    for ticket in tickets.iter().filter(|ticket| ticket.is_valid()) {
        let paid = i64::from(ticket.unit_amount_cents.unwrap_or(0));
        let checked_in = i64::from(ticket.checked_in_at.is_some());
        *issued.entry(ticket.event_date_id).or_default() += 1;
        *admitted.entry(ticket.event_date_id).or_default() += checked_in;
        let tier = tiers.entry(ticket.tier_id).or_insert(TicketTierCounts {
            tier_id: ticket.tier_id,
            issued: 0,
            checked_in: 0,
            revenue_cents: 0,
        });
        tier.issued += 1;
        tier.checked_in += checked_in;
        tier.revenue_cents += paid;
    }
    let valid = issued.values().sum();
    Ok(EventTicketDeskResponse {
        issued: valid,
        checked_in: admitted.values().sum(),
        refunded: tickets.len() as i64 - valid,
        revenue_cents: tiers.values().map(|tier| tier.revenue_cents).sum(),
        tiers: ticketing
            .tiers
            .iter()
            .map(|tier| {
                tiers.remove(&tier.id).unwrap_or(TicketTierCounts {
                    tier_id: tier.id,
                    issued: 0,
                    checked_in: 0,
                    revenue_cents: 0,
                })
            })
            .collect(),
        dates: event
            .occurrences
            .iter()
            .map(|occurrence| TicketDateCounts {
                event_date_id: occurrence.id,
                dtstart_utc: occurrence.dtstart_utc,
                issued: issued.get(&occurrence.id).copied().unwrap_or(0),
                checked_in: admitted.get(&occurrence.id).copied().unwrap_or(0),
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
            "SELECT et.event_id::int8 AS event_id, \
                    (SELECT coalesce(min(tier.price_cents), 0) FROM public.ticket_tiers tier \
                     WHERE tier.event_id = et.event_id) AS lowest_price_cents, \
                    et.currency, et.capacity, et.paused, \
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
                lowest_price_cents: row.try_get("lowest_price_cents")?,
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

#[cfg(test)]
mod tests {
    use chrono::TimeZone;

    use super::*;
    use crate::api::tickets::tests::event_with_dates;

    #[test]
    fn the_door_admits_the_date_closest_to_now() {
        // Three-hour sessions at 13:00 and 18:00 one day, and 18:00 a week later.
        let event = event_with_dates(
            42,
            &[(2026, 11, 20, 13), (2026, 11, 20, 18), (2026, 11, 27, 18)],
        );
        let ids: Vec<Uuid> = event.occurrences.iter().map(|date| date.id).collect();
        let at = |day, hour, minute| {
            Utc.with_ymd_and_hms(2026, 11, day, hour, minute, 0)
                .unwrap()
        };
        assert_eq!(door_date(&event, at(20, 12, 0)), Some(ids[0]));
        assert_eq!(door_date(&event, at(20, 15, 0)), Some(ids[0]));
        // Between the sessions, the evening's ticket waits until it is the closer one.
        assert_eq!(door_date(&event, at(20, 16, 30)), Some(ids[0]));
        assert_eq!(door_date(&event, at(20, 17, 30)), Some(ids[1]));
        assert_eq!(door_date(&event, at(20, 23, 0)), Some(ids[1]));
        assert_eq!(door_date(&event, at(27, 17, 0)), Some(ids[2]));
        // Nothing is open a week before, or long after the last session.
        assert_eq!(door_date(&event, at(13, 18, 0)), None);
        assert_eq!(door_date(&event, at(28, 12, 0)), None);
    }
}
