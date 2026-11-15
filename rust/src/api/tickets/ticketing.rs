//! What an event offers: a club turning tickets on, changing them or turning
//! them off, everyone's view of what is left, and the rules that keep an
//! event's edits and deletion from stranding the tickets people hold.

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use sqlx::PgConnection;
use uuid::Uuid;

use super::model::{
    EventTicketingResponse, ReleaseRow, TicketDateAvailability, TicketReleaseResponse, TicketingRow,
};
use super::releases::{self, Offer, SeatsTaken};
use super::{payouts, store};
use crate::api::AppState;
use crate::api::auth::User;
use crate::api::errors::ApiError;
use crate::api::events::model::{Event, Occurrence};
use crate::api::events::store::event_by_id;
use crate::api::messages::{
    EVENT_ALREADY_PAST, EVENT_HAS_PAID_TICKETS, EVENT_NOT_FOUND, TICKET_CAPACITY_BELOW_ISSUED,
    TICKET_DATE_HAS_TICKETS, TICKET_DATE_NOT_FOUND, TICKET_PRICE_LOCKED,
    TICKET_RELEASE_HAS_TICKETS, TICKET_RELEASE_NOT_FOUND, TICKETED_DATE_IN_USE,
    TICKETED_EVENT_CANCELLED, TICKETED_EVENT_CLUB_LOCKED, TICKETS_ALREADY_TAKEN, TICKETS_CLOSED,
    TICKETS_NOT_FOR_DATE, TICKETS_NOT_ON_SALE, TICKETS_OWN_EVENT, TICKETS_PAUSED,
    TICKETS_REQUIRE_CLUB, TICKETS_SOLD_OUT,
};
use crate::api::routes::clubs::managed_club;
use crate::controlbox::TICKETING;

/// What a club submits for its event.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TicketingInput {
    /// At least one; a saved release keeps its id.
    pub releases: Vec<ReleaseInput>,
    pub paused: bool,
    /// The event's dates that have tickets.
    pub dates: Vec<Uuid>,
}

/// One release as the club sets it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReleaseInput {
    pub id: Option<Uuid>,
    pub on_sale_at: DateTime<Utc>,
    pub quantity: Option<i32>,
    pub price_cents: i32,
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

/// The release a ticket to `occurrence` comes from right now, with what it
/// has left (`None` without a limit), or why nobody can get one: tickets
/// off this date, paused, the date over, nothing on sale yet, or sold out
/// (`lock_for_change` already refused a cancelled event).
pub fn release_on_sale<'a>(
    row: &'a TicketingRow,
    taken: &SeatsTaken,
    occurrence: &Occurrence,
    now: DateTime<Utc>,
) -> Result<(&'a ReleaseRow, Option<i64>), ApiError> {
    if !row.dates.contains(&occurrence.id) {
        return Err(ApiError::validation(TICKETS_NOT_FOR_DATE));
    }
    if row.paused {
        return Err(ApiError::validation(TICKETS_PAUSED));
    }
    if closes_at(occurrence) <= now {
        return Err(ApiError::validation(TICKETS_CLOSED));
    }
    match releases::offer(&row.releases, taken, occurrence.id, now) {
        Offer::OnSale { release, remaining } => Ok((release, remaining)),
        Offer::NotYet { .. } => Err(ApiError::validation(TICKETS_NOT_ON_SALE)),
        Offer::SoldOut => Err(ApiError::validation(TICKETS_SOLD_OUT)),
    }
}

/// The hosting club's own team runs the event, so it never takes tickets to it.
pub async fn refuse_own_event(
    connection: &mut PgConnection,
    event: &Event,
    user: &User,
) -> Result<(), ApiError> {
    if let Some(club_id) = event.club_id
        && store::is_club_member(&mut *connection, club_id, user.id).await?
    {
        return Err(ApiError::validation(TICKETS_OWN_EVENT));
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
    let taken = store::current_seats_taken(&state.db, event.id, now).await?;
    let in_use = store::current_releases_in_use(&state.db, event.id, now).await?;
    let dates: Vec<TicketDateAvailability> = event
        .occurrences
        .iter()
        .filter(|occurrence| row.dates.contains(&occurrence.id))
        .map(|occurrence| date_availability(row, &taken, occurrence, now))
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
        free: row.is_free(),
        currency: row.currency.clone(),
        paused: row.paused,
        available: payable && !row.paused && !event.cancelled && dates.iter().any(|date| date.open),
        maximum_per_order: if row.is_free() {
            1
        } else {
            TICKETING.maximum_tickets_per_order
        },
        releases: row
            .releases
            .iter()
            .map(|release| TicketReleaseResponse {
                id: release.id,
                on_sale_at: release.on_sale_at,
                quantity: release.quantity,
                price_cents: release.price_cents,
                has_tickets: in_use.contains(&release.id),
            })
            .collect(),
        dates,
    })
}

/// What one date with tickets offers at `now`.
fn date_availability(
    row: &TicketingRow,
    taken: &SeatsTaken,
    occurrence: &Occurrence,
    now: DateTime<Utc>,
) -> TicketDateAvailability {
    let closes = closes_at(occurrence);
    let offer = releases::offer(&row.releases, taken, occurrence.id, now);
    let open = closes > now && matches!(offer, Offer::OnSale { .. });
    let (price_cents, remaining, on_sale_at) = match offer {
        Offer::OnSale { release, remaining } => (release.price_cents, remaining, None),
        Offer::NotYet { release } => (
            release.price_cents,
            release.quantity.map(i64::from),
            // A release that opens after the date is over never opens for it.
            Some(release.on_sale_at).filter(|at| *at < closes),
        ),
        Offer::SoldOut => (
            row.releases.last().map_or(0, |release| release.price_cents),
            Some(0),
            None,
        ),
    };
    TicketDateAvailability {
        event_date_id: occurrence.id,
        dtstart_utc: occurrence.dtstart_utc,
        dtend_utc: occurrence.dtend_utc,
        price_cents,
        remaining,
        on_sale_at,
        open,
    }
}

/// Turn tickets on for an event, or change them: its releases, pausing,
/// and which of its dates have tickets.
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
    if input.dates.iter().any(|date| {
        !event
            .occurrences
            .iter()
            .any(|occurrence| occurrence.id == *date)
    }) {
        return Err(ApiError::validation(TICKET_DATE_NOT_FOUND));
    }
    let releases = releases::check(
        input
            .releases
            .iter()
            .map(|release| ReleaseRow {
                id: release.id.unwrap_or_else(Uuid::new_v4),
                on_sale_at: release.on_sale_at,
                quantity: release.quantity,
                price_cents: release.price_cents,
            })
            .collect(),
    )?;
    let paid_currency = if releases.iter().all(|release| release.price_cents == 0) {
        None
    } else {
        payouts::require_paid_tickets(state.settings)?;
        let account = payouts::ready_account(&state.db, club_id).await?;
        Some(payouts::currency(&account.country))
    };

    let mut transaction = state.db.begin().await?;
    let existing = lock_for_change(&mut transaction, event_id).await?;
    let saved: HashMap<Uuid, &ReleaseRow> = existing
        .iter()
        .flat_map(|row| row.releases.iter())
        .map(|release| (release.id, release))
        .collect();
    if input
        .releases
        .iter()
        .filter_map(|release| release.id)
        .any(|id| !saved.contains_key(&id))
    {
        return Err(ApiError::validation(TICKET_RELEASE_NOT_FOUND));
    }
    if let Some(existing) = &existing {
        let in_use = store::releases_in_use(&mut *transaction, event_id, now).await?;
        // A release people got tickets from keeps its price, and stays.
        for id in &in_use {
            match releases.iter().find(|release| release.id == *id) {
                None => return Err(ApiError::conflict(TICKET_RELEASE_HAS_TICKETS)),
                Some(release)
                    if saved
                        .get(id)
                        .is_some_and(|old| old.price_cents != release.price_cents) =>
                {
                    return Err(ApiError::conflict(TICKET_PRICE_LOCKED));
                }
                Some(_) => {}
            }
        }
        // A date people hold tickets to keeps them: pausing stops new ones.
        let dropped: Vec<Uuid> = existing
            .dates
            .iter()
            .filter(|date| !input.dates.contains(date))
            .copied()
            .collect();
        if !dropped.is_empty()
            && store::has_tickets_or_holds(&mut *transaction, event_id, Some(&dropped), now).await?
        {
            return Err(ApiError::conflict(TICKET_DATE_HAS_TICKETS));
        }
        let issued = store::valid_tickets_by_release(&mut *transaction, event_id).await?;
        if issued.iter().any(|((release_id, _), count)| {
            releases
                .iter()
                .find(|release| release.id == *release_id)
                .and_then(|release| release.quantity)
                .is_some_and(|quantity| i64::from(quantity) < *count)
        }) {
            return Err(ApiError::conflict(TICKET_CAPACITY_BELOW_ISSUED));
        }
    }
    // A Stripe account settles in one currency: the first paid price fixes it.
    let currency = match (&existing, paid_currency) {
        (Some(existing), Some(_)) if existing.currency.is_some() => existing.currency.clone(),
        (_, currency) => currency,
    };
    sqlx::query(
        "INSERT INTO public.event_ticketing (event_id, currency, paused, updated_by) \
         VALUES ($1, $2, $3, $4) \
         ON CONFLICT (event_id) DO UPDATE SET currency = excluded.currency, \
         paused = excluded.paused, updated_by = excluded.updated_by",
    )
    .bind(event_id as i32)
    .bind(&currency)
    .bind(input.paused)
    .bind(manager.id)
    .execute(&mut *transaction)
    .await?;
    save_releases(&mut transaction, event_id, &releases, now).await?;
    sqlx::query(
        "DELETE FROM public.event_ticketing_dates \
         WHERE event_id = $1 AND NOT (event_date_id = ANY($2))",
    )
    .bind(event_id as i32)
    .bind(&input.dates)
    .execute(&mut *transaction)
    .await?;
    sqlx::query(
        "INSERT INTO public.event_ticketing_dates (event_id, event_date_id) \
         SELECT $1, date FROM unnest($2::uuid[]) AS date ON CONFLICT (event_date_id) DO NOTHING",
    )
    .bind(event_id as i32)
    .bind(&input.dates)
    .execute(&mut *transaction)
    .await?;
    // The event's own price and registration flag follow its tickets, so its
    // card, filters and search show the least anyone pays.
    let lowest_cents = releases
        .iter()
        .map(|release| release.price_cents)
        .min()
        .unwrap_or(0);
    sqlx::query("UPDATE public.events SET price = $2, registration = true WHERE id = $1")
        .bind(event_id as i32)
        .bind(f64::from(lowest_cents) / 100.0)
        .execute(&mut *transaction)
        .await?;
    transaction.commit().await?;

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

/// Write the event's releases as the club set them: the ones it left out go
/// (with the checkouts that ended on them, which hold nothing), the rest are
/// added or changed. Two releases may trade sale times: the unique (event,
/// time) key is checked when the transaction commits.
async fn save_releases(
    connection: &mut PgConnection,
    event_id: i64,
    releases: &[ReleaseRow],
    now: DateTime<Utc>,
) -> Result<(), sqlx::Error> {
    let ids: Vec<Uuid> = releases.iter().map(|release| release.id).collect();
    sqlx::query(
        "DELETE FROM public.ticket_orders WHERE event_id = $1 AND NOT (release_id = ANY($2)) \
         AND (status IN ('expired', 'failed') OR (status = 'pending' AND reserved_until <= $3))",
    )
    .bind(event_id as i32)
    .bind(&ids)
    .bind(now)
    .execute(&mut *connection)
    .await?;
    sqlx::query(
        "DELETE FROM public.event_ticket_releases WHERE event_id = $1 AND NOT (id = ANY($2))",
    )
    .bind(event_id as i32)
    .bind(&ids)
    .execute(&mut *connection)
    .await?;
    let on_sale: Vec<DateTime<Utc>> = releases.iter().map(|release| release.on_sale_at).collect();
    let quantities: Vec<Option<i32>> = releases.iter().map(|release| release.quantity).collect();
    let prices: Vec<i32> = releases.iter().map(|release| release.price_cents).collect();
    sqlx::query(
        "INSERT INTO public.event_ticket_releases (id, event_id, on_sale_at, quantity, price_cents) \
         SELECT id, $1, on_sale_at, quantity, price_cents \
         FROM unnest($2::uuid[], $3::timestamptz[], $4::int4[], $5::int4[]) \
           AS release (id, on_sale_at, quantity, price_cents) \
         ON CONFLICT (id) DO UPDATE SET on_sale_at = excluded.on_sale_at, \
         quantity = excluded.quantity, price_cents = excluded.price_cents",
    )
    .bind(event_id as i32)
    .bind(&ids)
    .bind(&on_sale)
    .bind(&quantities)
    .bind(&prices)
    .execute(&mut *connection)
    .await?;
    Ok(())
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
    if store::has_tickets_or_holds(&mut *transaction, event_id, None, now).await? {
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

    fn row(paused: bool, on_sale_at: DateTime<Utc>, quantity: Option<i32>) -> TicketingRow {
        TicketingRow {
            event_id: 42,
            currency: None,
            paused,
            dates: vec![Uuid::from_u128(1)],
            releases: vec![ReleaseRow {
                id: Uuid::from_u128(7),
                on_sale_at,
                quantity,
                price_cents: 0,
            }],
        }
    }

    fn refusal(result: Result<(&ReleaseRow, Option<i64>), ApiError>) -> String {
        match result {
            Err(ApiError::Validation { detail, .. }) => detail,
            other => panic!("expected a refusal, got {other:?}"),
        }
    }

    #[test]
    fn a_ticketed_date_takes_tickets_from_its_release_until_it_ends() {
        let event = event_with_dates(42, &[(2026, 11, 20, 23)]);
        let occurrence = &event.occurrences[0];
        let start = Utc.with_ymd_and_hms(2026, 11, 20, 23, 0, 0).unwrap();
        let on_sale = start - Duration::days(5);
        let taken = SeatsTaken::new();
        // The test event runs three hours.
        assert_eq!(closes_at(occurrence), start + Duration::hours(3));
        let open = row(false, on_sale, Some(2));
        let (release, remaining) = release_on_sale(&open, &taken, occurrence, start).unwrap();
        assert_eq!((release.id, remaining), (Uuid::from_u128(7), Some(2)));
        assert_eq!(
            refusal(release_on_sale(
                &open,
                &taken,
                occurrence,
                start + Duration::hours(3)
            )),
            TICKETS_CLOSED
        );
        assert_eq!(
            refusal(release_on_sale(
                &row(true, on_sale, None),
                &taken,
                occurrence,
                start
            )),
            TICKETS_PAUSED
        );
        assert_eq!(
            refusal(release_on_sale(
                &open,
                &taken,
                occurrence,
                on_sale - Duration::minutes(1)
            )),
            TICKETS_NOT_ON_SALE
        );
        let full = SeatsTaken::from([((Uuid::from_u128(7), occurrence.id), 2)]);
        assert_eq!(
            refusal(release_on_sale(&open, &full, occurrence, start)),
            TICKETS_SOLD_OUT
        );
        let mut untouched = row(false, on_sale, None);
        untouched.dates.clear();
        assert_eq!(
            refusal(release_on_sale(&untouched, &taken, occurrence, start)),
            TICKETS_NOT_FOR_DATE
        );
    }

    #[test]
    fn a_date_says_when_its_tickets_go_on_sale() {
        let event = event_with_dates(42, &[(2026, 11, 20, 23)]);
        let occurrence = &event.occurrences[0];
        let on_sale = Utc.with_ymd_and_hms(2026, 11, 15, 14, 0, 0).unwrap();
        let waiting = row(false, on_sale, Some(30));
        let before = date_availability(
            &waiting,
            &SeatsTaken::new(),
            occurrence,
            on_sale - Duration::hours(1),
        );
        assert_eq!(
            (before.open, before.on_sale_at, before.remaining),
            (false, Some(on_sale), Some(30))
        );
        let after = date_availability(&waiting, &SeatsTaken::new(), occurrence, on_sale);
        assert_eq!((after.open, after.on_sale_at), (true, None));
        // A release that opens after the date is over never opens for it.
        let late = row(
            false,
            Utc.with_ymd_and_hms(2026, 11, 22, 0, 0, 0).unwrap(),
            None,
        );
        let never = date_availability(&late, &SeatsTaken::new(), occurrence, on_sale);
        assert_eq!((never.open, never.on_sale_at), (false, None));
    }
}
