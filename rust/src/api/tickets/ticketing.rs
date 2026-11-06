//! What an event offers: a club turning tickets on, changing them or turning
//! them off, everyone's view of what is left, and the rules that keep an
//! event's edits and deletion from stranding the tickets people hold.

use chrono::{DateTime, Utc};
use sqlx::PgConnection;
use uuid::Uuid;

use super::model::{EventTicketingResponse, TicketDateAvailability, TicketingRow};
use super::{codes, emails, payouts, store};
use crate::api::AppState;
use crate::api::auth::User;
use crate::api::errors::ApiError;
use crate::api::events::model::{Event, Occurrence};
use crate::api::events::store::event_by_id;
use crate::api::messages::{
    EVENT_ALREADY_PAST, EVENT_HAS_PAID_TICKETS, EVENT_NOT_FOUND, TICKET_CAPACITY_BELOW_GOING,
    TICKET_CAPACITY_BELOW_ISSUED, TICKET_CAPACITY_TOO_HIGH, TICKET_PRICE_LOCKED,
    TICKET_PRICE_OUT_OF_RANGE, TICKETED_DATE_IN_USE, TICKETED_EVENT_CANCELLED,
    TICKETED_EVENT_CLUB_LOCKED, TICKETS_ALREADY_TAKEN, TICKETS_CLOSED, TICKETS_PAUSED,
    TICKETS_REQUIRE_CLUB,
};
use crate::api::routes::clubs::managed_club;
use crate::controlbox::TICKETING;

/// What a club submits for its event; a price of zero means free tickets.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TicketingInput {
    pub price_cents: i32,
    pub capacity: Option<i32>,
    pub paused: bool,
}

/// The event, when `user` is on the team of the club hosting it, or an admin.
/// Admins still run an event whose club was deleted, so its door keeps working.
pub async fn managed_event(
    state: &AppState,
    event_id: i64,
    user: &User,
) -> Result<Event, ApiError> {
    let event = event_by_id(&state.db, event_id)
        .await?
        .ok_or_else(|| ApiError::not_found(EVENT_NOT_FOUND))?;
    match event.club_id {
        Some(club_id) => {
            managed_club(&state.db, club_id, user).await?;
        }
        None if user.is_admin() => {}
        None => return Err(ApiError::validation(TICKETS_REQUIRE_CLUB)),
    }
    Ok(event)
}

/// `user` runs the event's club (or is an admin), so can admit its tickets.
pub async fn manages(state: &AppState, event: &Event, user: Option<&User>) -> bool {
    match (user, event.club_id) {
        (Some(user), Some(club_id)) => managed_club(&state.db, club_id, user).await.is_ok(),
        (Some(user), None) => user.is_admin(),
        _ => false,
    }
}

/// Lock the event, then its ticketing row (`store::lock_event`). Returns
/// whether the event is cancelled, and its ticketing row if it has one.
async fn lock(
    connection: &mut PgConnection,
    event_id: i64,
) -> Result<(bool, Option<TicketingRow>), ApiError> {
    let cancelled = store::lock_event(&mut *connection, event_id)
        .await?
        .ok_or_else(|| ApiError::not_found(EVENT_NOT_FOUND))?;
    Ok((
        cancelled,
        store::lock_ticketing(&mut *connection, event_id).await?,
    ))
}

/// `lock`, for a change only a running event takes: tickets being turned on,
/// changed, taken or bought. A cancellation that won the lock refuses it.
pub async fn lock_for_change(
    connection: &mut PgConnection,
    event_id: i64,
) -> Result<Option<TicketingRow>, ApiError> {
    match lock(connection, event_id).await? {
        (true, _) => Err(ApiError::validation(TICKETED_EVENT_CANCELLED)),
        (false, row) => Ok(row),
    }
}

/// A date takes tickets until it ends, or until it starts when it has no end:
/// a free event's walk-ins can still take one at the door.
pub fn closes_at(occurrence: &Occurrence) -> DateTime<Utc> {
    occurrence.dtend_utc.unwrap_or(occurrence.dtstart_utc)
}

/// The event's dates still taking tickets.
fn open_dates(event: &Event, now: DateTime<Utc>) -> Vec<Uuid> {
    event
        .occurrences
        .iter()
        .filter(|occurrence| closes_at(occurrence) > now)
        .map(|occurrence| occurrence.id)
        .collect()
}

/// Why nobody can take a ticket for `occurrence` right now, as an error
/// (`lock_for_change` already refused a cancelled event).
pub fn refuse_unless_open(
    row: &TicketingRow,
    occurrence: &Occurrence,
    now: DateTime<Utc>,
) -> Result<(), ApiError> {
    if row.paused {
        return Err(ApiError::validation(TICKETS_PAUSED));
    }
    if closes_at(occurrence) <= now {
        return Err(ApiError::validation(TICKETS_CLOSED));
    }
    Ok(())
}

/// The event's tickets as anyone viewing it sees them, or `None` without tickets.
pub async fn current(
    state: &AppState,
    event_id: i64,
) -> Result<Option<EventTicketingResponse>, ApiError> {
    let event = event_by_id(&state.db, event_id)
        .await?
        .ok_or_else(|| ApiError::not_found(EVENT_NOT_FOUND))?;
    match store::ticketing(&state.db, event_id).await? {
        Some(row) => Ok(Some(view(state, &event, &row, Utc::now()).await?)),
        None => Ok(None),
    }
}

pub async fn view(
    state: &AppState,
    event: &Event,
    row: &TicketingRow,
    now: DateTime<Utc>,
) -> Result<EventTicketingResponse, ApiError> {
    let taken = store::seats_taken_by_date(&state.db, event.id, now).await?;
    let dates: Vec<TicketDateAvailability> = event
        .occurrences
        .iter()
        .map(|occurrence| {
            let remaining = row.capacity.map(|capacity| {
                (i64::from(capacity) - taken.get(&occurrence.id).copied().unwrap_or(0)).max(0)
            });
            TicketDateAvailability {
                event_date_id: occurrence.id,
                dtstart_utc: occurrence.dtstart_utc,
                dtend_utc: occurrence.dtend_utc,
                remaining,
                open: closes_at(occurrence) > now && remaining != Some(0),
            }
        })
        .collect();
    // A paid event takes money only while its club's Stripe account can.
    let payable = row.is_free()
        || (payouts::paid_tickets_available(state.settings)
            && match event.club_id {
                Some(club_id) => store::payment_account(&state.db, club_id)
                    .await?
                    .is_some_and(|account| account.charges_enabled),
                None => false,
            });
    Ok(EventTicketingResponse {
        event_id: event.id,
        price_cents: row.price_cents,
        currency: row.currency.clone(),
        capacity: row.capacity,
        paused: row.paused,
        available: payable && !row.paused && !event.cancelled && dates.iter().any(|date| date.open),
        maximum_per_order: if row.is_free() {
            1
        } else {
            TICKETING.maximum_tickets_per_order
        },
        dates,
    })
}

/// Turn tickets on for an event, or change them. Turning free tickets on
/// hands one to everyone already going, so nobody who registered is left out.
pub async fn configure(
    state: &AppState,
    event_id: i64,
    input: TicketingInput,
    manager: &User,
) -> Result<EventTicketingResponse, ApiError> {
    let event = managed_event(state, event_id, manager).await?;
    // An admin still runs the door of an event whose club is gone, but only a
    // club's event takes tickets.
    let club_id = event
        .club_id
        .ok_or_else(|| ApiError::validation(TICKETS_REQUIRE_CLUB))?;
    let now = Utc::now();
    if event.has_ended(now) {
        return Err(ApiError::validation(EVENT_ALREADY_PAST));
    }
    if input
        .capacity
        .is_some_and(|capacity| capacity > TICKETING.maximum_capacity)
    {
        return Err(ApiError::validation(TICKET_CAPACITY_TOO_HIGH));
    }
    let paid_currency = if input.price_cents == 0 {
        None
    } else {
        payouts::require_paid_tickets(state.settings)?;
        if !(TICKETING.minimum_price_cents..=TICKETING.maximum_price_cents)
            .contains(&input.price_cents)
        {
            return Err(ApiError::validation(TICKET_PRICE_OUT_OF_RANGE));
        }
        let account = payouts::ready_account(&state.db, club_id).await?;
        Some(payouts::currency(&account.country))
    };

    let mut transaction = state.db.begin().await?;
    let existing = lock_for_change(&mut transaction, event_id).await?;
    if let Some(existing) = &existing
        && existing.price_cents != input.price_cents
        && store::has_tickets_or_holds(&mut *transaction, event_id, now).await?
    {
        return Err(ApiError::conflict(TICKET_PRICE_LOCKED));
    }
    // Free tickets going on hand one to everyone already going, so the
    // capacity has to fit them; afterwards it has to fit the tickets taken.
    let hands_out = existing.is_none() && input.price_cents == 0;
    if let Some(capacity) = input.capacity {
        let (taken, refusal) = if hands_out {
            let open = open_dates(&event, now);
            (
                store::going_by_date(&mut *transaction, event_id, &open).await?,
                TICKET_CAPACITY_BELOW_GOING,
            )
        } else {
            (
                store::valid_tickets_by_date(&mut *transaction, event_id).await?,
                TICKET_CAPACITY_BELOW_ISSUED,
            )
        };
        if taken.values().any(|count| *count > i64::from(capacity)) {
            return Err(ApiError::conflict(refusal));
        }
    }
    // A Stripe account settles in one currency: the first paid price fixes it.
    let currency = match (&existing, paid_currency) {
        (Some(existing), Some(_)) if existing.currency.is_some() => existing.currency.clone(),
        (_, currency) => currency,
    };
    sqlx::query(
        "INSERT INTO public.event_ticketing (event_id, price_cents, currency, capacity, paused, updated_by) \
         VALUES ($1, $2, $3, $4, $5, $6) \
         ON CONFLICT (event_id) DO UPDATE SET price_cents = excluded.price_cents, \
         currency = excluded.currency, capacity = excluded.capacity, paused = excluded.paused, \
         updated_by = excluded.updated_by",
    )
    .bind(event_id as i32)
    .bind(input.price_cents)
    .bind(&currency)
    .bind(input.capacity)
    .bind(input.paused)
    .bind(manager.id)
    .execute(&mut *transaction)
    .await?;
    // The event's own price and registration flag follow its tickets, so its
    // card, filters and search show what people pay.
    sqlx::query("UPDATE public.events SET price = $2, registration = true WHERE id = $1")
        .bind(event_id as i32)
        .bind(f64::from(input.price_cents) / 100.0)
        .execute(&mut *transaction)
        .await?;
    let handed_out = if hands_out {
        hand_out_to_everyone_going(&mut transaction, &event, now).await?
    } else {
        Vec::new()
    };
    transaction.commit().await?;

    for ticket in handed_out {
        if let Some(occurrence) = event
            .occurrences
            .iter()
            .find(|occurrence| occurrence.id == ticket.event_date_id)
        {
            emails::send_tickets(
                state.db.clone(),
                state.settings,
                event.clone(),
                occurrence.clone(),
                ticket.email,
                vec![ticket.code.clone()],
                None,
                format!("ticket:{}", ticket.code),
            );
        }
    }
    crate::revalidation::revalidate_schools(
        &event.school.iter().cloned().collect::<Vec<_>>(),
        &["events"],
    )
    .await;
    let row = store::ticketing(&state.db, event_id)
        .await?
        .ok_or_else(|| ApiError::Internal(anyhow::anyhow!("ticketing for {event_id} vanished")))?;
    view(state, &event, &row, now).await
}

/// Turn tickets off for an event nobody has a ticket to yet; afterwards the
/// club pauses them instead.
pub async fn stop(state: &AppState, event_id: i64, manager: &User) -> Result<(), ApiError> {
    let event = managed_event(state, event_id, manager).await?;
    let now = Utc::now();
    let mut transaction = state.db.begin().await?;
    if lock(&mut transaction, event_id).await?.1.is_none() {
        return Ok(());
    }
    if store::has_tickets_or_holds(&mut *transaction, event_id, now).await? {
        return Err(ApiError::conflict(TICKETS_ALREADY_TAKEN));
    }
    store::release_dates(&mut transaction, event_id, None, now).await?;
    sqlx::query("DELETE FROM public.event_ticketing WHERE event_id = $1")
        .bind(event_id as i32)
        .execute(&mut *transaction)
        .await?;
    if !event.has_ended(now) {
        sqlx::query("UPDATE public.events SET registration = false WHERE id = $1")
            .bind(event_id as i32)
            .execute(&mut *transaction)
            .await?;
    }
    transaction.commit().await?;
    crate::revalidation::revalidate_schools(
        &event.school.iter().cloned().collect::<Vec<_>>(),
        &["events"],
    )
    .await;
    Ok(())
}

/// A free ticket handed out to someone already going.
struct HandedOut {
    event_date_id: Uuid,
    email: String,
    code: String,
}

async fn hand_out_to_everyone_going(
    connection: &mut PgConnection,
    event: &Event,
    now: DateTime<Utc>,
) -> Result<Vec<HandedOut>, ApiError> {
    let open = open_dates(event, now);
    let going: Vec<(Uuid, Uuid, String)> = sqlx::query_as(
        "SELECT g.user_id, g.event_date_id, u.email FROM public.user_going_events g \
         JOIN public.users u ON u.id = g.user_id \
         WHERE g.event_id = $1 AND g.event_date_id = ANY($2) ORDER BY g.going_at",
    )
    .bind(event.id)
    .bind(&open)
    .fetch_all(&mut *connection)
    .await?;
    let mut handed_out = Vec::with_capacity(going.len());
    for (user_id, event_date_id, email) in going {
        let code = codes::new_code();
        store::insert_free_ticket(&mut *connection, event.id, event_date_id, user_id, &code)
            .await?;
        handed_out.push(HandedOut {
            event_date_id,
            email,
            code,
        });
    }
    Ok(handed_out)
}

/// Inside an event edit's transaction: an event with tickets keeps its club,
/// and drops only dates nobody paid for, taking their free tickets with them.
pub async fn guard_edit(
    connection: &mut PgConnection,
    event: &Event,
    new_club_id: Option<i64>,
    kept_dates: Option<&[Uuid]>,
    now: DateTime<Utc>,
) -> Result<(), ApiError> {
    if lock(&mut *connection, event.id).await?.1.is_none() {
        return Ok(());
    }
    if new_club_id.is_some_and(|club_id| Some(club_id) != event.club_id) {
        return Err(ApiError::conflict(TICKETED_EVENT_CLUB_LOCKED));
    }
    let Some(kept) = kept_dates else {
        return Ok(());
    };
    let removed: Vec<Uuid> = event
        .occurrences
        .iter()
        .map(|occurrence| occurrence.id)
        .filter(|id| !kept.contains(id))
        .collect();
    if removed.is_empty() {
        return Ok(());
    }
    if store::dates_with_paid_orders_or_holds(&mut *connection, event.id, &removed, now).await? {
        return Err(ApiError::conflict(TICKETED_DATE_IN_USE));
    }
    store::release_dates(connection, event.id, Some(&removed), now).await?;
    Ok(())
}

/// Inside an event deletion's transaction: an event people paid for is
/// cancelled instead (which refunds them); free tickets go with it.
pub async fn guard_delete(
    connection: &mut PgConnection,
    event_id: i64,
    now: DateTime<Utc>,
) -> Result<(), ApiError> {
    lock(&mut *connection, event_id).await?;
    if store::has_paid_orders_or_holds(&mut *connection, event_id, now).await? {
        return Err(ApiError::conflict(EVENT_HAS_PAID_TICKETS));
    }
    store::release_dates(connection, event_id, None, now).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use chrono::{Duration, TimeZone};

    use super::*;
    use crate::api::tickets::tests::event_with_dates;

    fn row(paused: bool) -> TicketingRow {
        TicketingRow {
            event_id: 42,
            price_cents: 0,
            currency: None,
            capacity: None,
            paused,
        }
    }

    #[test]
    fn a_date_takes_tickets_until_it_ends() {
        let event = event_with_dates(42, &[(2026, 11, 20, 23)]);
        let occurrence = &event.occurrences[0];
        let start = Utc.with_ymd_and_hms(2026, 11, 20, 23, 0, 0).unwrap();
        // The test event runs three hours.
        assert_eq!(closes_at(occurrence), start + Duration::hours(3));
        assert!(refuse_unless_open(&row(false), occurrence, start).is_ok());
        assert!(matches!(
            refuse_unless_open(&row(false), occurrence, start + Duration::hours(3)),
            Err(ApiError::Validation { detail, .. }) if detail == TICKETS_CLOSED
        ));
        assert!(matches!(
            refuse_unless_open(&row(true), occurrence, start),
            Err(ApiError::Validation { detail, .. }) if detail == TICKETS_PAUSED
        ));
        assert_eq!(open_dates(&event, start), [occurrence.id]);
        assert!(open_dates(&event, start + Duration::hours(3)).is_empty());
    }
}
