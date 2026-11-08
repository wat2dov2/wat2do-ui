//! What an event offers: a club turning tickets on, changing them or turning
//! them off, everyone's view of what is left, and the rules that keep an
//! event's edits and deletion from stranding the tickets people hold.

use chrono::{DateTime, Utc};
use sqlx::{PgConnection, PgPool};
use uuid::Uuid;

use std::collections::{HashMap, HashSet};

use super::model::{
    EventTicketingResponse, TicketDateAvailability, TicketTierAvailability, TicketingRow, TierRow,
};
use super::{codes, emails, payouts, store};
use crate::api::AppState;
use crate::api::auth::User;
use crate::api::errors::ApiError;
use crate::api::events::model::{Event, Occurrence};
use crate::api::events::store::event_by_id;
use crate::api::messages::{
    EVENT_ALREADY_PAST, EVENT_HAS_PAID_TICKETS, EVENT_NOT_FOUND, TICKET_CAPACITY_BELOW_GOING,
    TICKET_CAPACITY_BELOW_ISSUED, TICKET_CAPACITY_TOO_HIGH, TICKET_PRICE_LOCKED,
    TICKET_PRICE_OUT_OF_RANGE, TICKET_TIER_IN_USE, TICKET_TIER_NAMES_REPEAT, TICKET_TIER_NOT_FOUND,
    TICKET_TIERS_TOO_MANY, TICKETED_DATE_IN_USE, TICKETED_EVENT_CANCELLED,
    TICKETED_EVENT_CLUB_LOCKED, TICKETS_ALREADY_TAKEN, TICKETS_CLOSED, TICKETS_PAUSED,
    TICKETS_REQUIRE_CLUB,
};
use crate::api::routes::clubs::managed_club;
use crate::controlbox::TICKETING;
use crate::db::read_with_retry;

/// What a club submits for its event: one limit on every ticket, and the
/// tiers people choose from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TicketingInput {
    pub capacity: Option<i32>,
    pub paused: bool,
    pub tiers: Vec<TierInput>,
}

/// One tier as the club submits it; a price of zero makes it free.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TierInput {
    /// The tier being changed; `None` for a new one.
    pub id: Option<Uuid>,
    pub name: String,
    pub price_cents: i32,
    pub capacity: Option<i32>,
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
    let tiers = tiers(&state.db, event.id).await?;
    let taken = read_with_retry(|| store::seats_taken_by_tier(&state.db, event.id, now)).await?;
    // A paid tier takes money only while its club's Stripe account can.
    let payable = payouts::paid_tickets_available(state.settings)
        && match event.club_id {
            Some(club_id) => store::payment_account(&state.db, club_id)
                .await?
                .is_some_and(|account| account.charges_enabled),
            None => false,
        };
    Ok(availability(event, row, &tiers, &taken, payable, now))
}

async fn tiers(db: &PgPool, event_id: i64) -> Result<Vec<TierRow>, sqlx::Error> {
    read_with_retry(|| store::tiers(db, event_id)).await
}

/// What is left of the event's tickets and of each tier, given the seats each
/// tier has given out, and whether the club can take money right now.
fn availability(
    event: &Event,
    row: &TicketingRow,
    tiers: &[TierRow],
    taken: &HashMap<Uuid, i64>,
    payable: bool,
    now: DateTime<Utc>,
) -> EventTicketingResponse {
    let dates: Vec<TicketDateAvailability> = event
        .occurrences
        .iter()
        .map(|occurrence| TicketDateAvailability {
            event_date_id: occurrence.id,
            dtstart_utc: occurrence.dtstart_utc,
            dtend_utc: occurrence.dtend_utc,
            open: closes_at(occurrence) > now,
        })
        .collect();
    let remaining = row
        .capacity
        .map(|capacity| (i64::from(capacity) - taken.values().sum::<i64>()).max(0));
    let tiers: Vec<TicketTierAvailability> = tiers
        .iter()
        .map(|tier| {
            let own = tier.capacity.map(|capacity| {
                (i64::from(capacity) - taken.get(&tier.id).copied().unwrap_or(0)).max(0)
            });
            let left = match (own, remaining) {
                (Some(own), Some(event)) => Some(own.min(event)),
                (own, event) => own.or(event),
            };
            TicketTierAvailability {
                id: tier.id,
                name: tier.name.clone(),
                price_cents: tier.price_cents,
                capacity: tier.capacity,
                remaining: left,
                maximum_per_order: if tier.is_free() {
                    1
                } else {
                    TICKETING.maximum_tickets_per_order
                },
                open: left != Some(0) && (tier.is_free() || payable),
            }
        })
        .collect();
    EventTicketingResponse {
        event_id: event.id,
        currency: row.currency.clone(),
        capacity: row.capacity,
        remaining,
        paused: row.paused,
        available: !row.paused
            && !event.cancelled
            && dates.iter().any(|date| date.open)
            && tiers.iter().any(|tier| tier.open),
        tiers,
        dates,
    }
}

/// Check a club's tiers before anything is locked: how many, their names,
/// prices and limits. Returns whether any tier is paid.
fn check_tiers(input: &TicketingInput) -> Result<bool, ApiError> {
    if input.tiers.len() > TICKETING.maximum_tiers {
        return Err(ApiError::validation(TICKET_TIERS_TOO_MANY));
    }
    let mut names = HashSet::new();
    if !input
        .tiers
        .iter()
        .all(|tier| names.insert(tier.name.to_lowercase()))
    {
        return Err(ApiError::validation(TICKET_TIER_NAMES_REPEAT));
    }
    let limits =
        std::iter::once(input.capacity).chain(input.tiers.iter().map(|tier| tier.capacity));
    if limits
        .flatten()
        .any(|capacity| capacity > TICKETING.maximum_capacity)
    {
        return Err(ApiError::validation(TICKET_CAPACITY_TOO_HIGH));
    }
    let prices = TICKETING.minimum_price_cents..=TICKETING.maximum_price_cents;
    if input
        .tiers
        .iter()
        .any(|tier| tier.price_cents != 0 && !prices.contains(&tier.price_cents))
    {
        return Err(ApiError::validation(TICKET_PRICE_OUT_OF_RANGE));
    }
    Ok(input.tiers.iter().any(|tier| tier.price_cents > 0))
}

/// Turn tickets on for an event, or change them. Turning tickets on with one
/// free tier hands a ticket to everyone already going, so nobody who
/// registered is left out.
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
    let paid_currency = if check_tiers(&input)? {
        payouts::require_paid_tickets(state.settings)?;
        let account = payouts::ready_account(&state.db, club_id).await?;
        Some(payouts::currency(&account.country))
    } else {
        None
    };

    let mut transaction = state.db.begin().await?;
    let existing = lock_for_change(&mut transaction, event_id).await?;
    let current = if existing.is_some() {
        store::tiers(&mut *transaction, event_id).await?
    } else {
        Vec::new()
    };
    let issued = store::valid_tickets_by_tier(&mut *transaction, event_id).await?;
    for tier in &input.tiers {
        let Some(id) = tier.id else { continue };
        let before = current
            .iter()
            .find(|current| current.id == id)
            .ok_or_else(|| ApiError::validation(TICKET_TIER_NOT_FOUND))?;
        let in_use = store::tier_in_use(&mut *transaction, id, now).await?;
        if before.price_cents != tier.price_cents && in_use {
            return Err(ApiError::conflict(TICKET_PRICE_LOCKED));
        }
        if tier
            .capacity
            .is_some_and(|capacity| issued.get(&id).copied().unwrap_or(0) > i64::from(capacity))
        {
            return Err(ApiError::conflict(TICKET_CAPACITY_BELOW_ISSUED));
        }
    }
    let kept: HashSet<Uuid> = input.tiers.iter().filter_map(|tier| tier.id).collect();
    let removed: Vec<&TierRow> = current
        .iter()
        .filter(|tier| !kept.contains(&tier.id))
        .collect();
    for tier in &removed {
        if store::tier_in_use(&mut *transaction, tier.id, now).await? {
            return Err(ApiError::conflict(TICKET_TIER_IN_USE));
        }
    }
    // One free tier going on hands a ticket to everyone already going, so
    // the limits have to fit them; afterwards they have to fit the tickets taken.
    let hands_out =
        existing.is_none() && matches!(input.tiers.as_slice(), [only] if only.price_cents == 0);
    if hands_out {
        let going =
            store::going_count(&mut *transaction, event_id, &open_dates(&event, now)).await?;
        let limits =
            std::iter::once(input.capacity).chain(input.tiers.iter().map(|tier| tier.capacity));
        if limits.flatten().any(|capacity| going > i64::from(capacity)) {
            return Err(ApiError::conflict(TICKET_CAPACITY_BELOW_GOING));
        }
    } else if input
        .capacity
        .is_some_and(|capacity| issued.values().sum::<i64>() > i64::from(capacity))
    {
        return Err(ApiError::conflict(TICKET_CAPACITY_BELOW_ISSUED));
    }
    // A Stripe account settles in one currency: the first paid price fixes it.
    let currency = paid_currency.map(|currency| {
        existing
            .as_ref()
            .and_then(|existing| existing.currency.clone())
            .unwrap_or(currency)
    });
    sqlx::query(
        "INSERT INTO public.event_ticketing (event_id, currency, capacity, paused, updated_by) \
         VALUES ($1, $2, $3, $4, $5) \
         ON CONFLICT (event_id) DO UPDATE SET currency = excluded.currency, \
         capacity = excluded.capacity, paused = excluded.paused, updated_by = excluded.updated_by",
    )
    .bind(event_id as i32)
    .bind(&currency)
    .bind(input.capacity)
    .bind(input.paused)
    .bind(manager.id)
    .execute(&mut *transaction)
    .await?;
    for tier in removed {
        store::delete_tier(&mut transaction, tier.id).await?;
    }
    let mut first_tier = None;
    for (position, tier) in input.tiers.iter().enumerate() {
        let id: Uuid = sqlx::query_scalar(
            "INSERT INTO public.ticket_tiers (id, event_id, name, price_cents, capacity, position) \
             VALUES ($1, $2, $3, $4, $5, $6) \
             ON CONFLICT (id) DO UPDATE SET name = excluded.name, \
             price_cents = excluded.price_cents, capacity = excluded.capacity, \
             position = excluded.position \
             RETURNING id",
        )
        .bind(tier.id.unwrap_or_else(Uuid::new_v4))
        .bind(event_id as i32)
        .bind(&tier.name)
        .bind(tier.price_cents)
        .bind(tier.capacity)
        .bind(position as i32)
        .fetch_one(&mut *transaction)
        .await?;
        first_tier.get_or_insert(id);
    }
    // The event's own price and registration flag follow its tickets, so its
    // card, filters and search show the least anyone pays.
    let lowest = input
        .tiers
        .iter()
        .map(|tier| tier.price_cents)
        .min()
        .unwrap_or(0);
    sqlx::query("UPDATE public.events SET price = $2, registration = true WHERE id = $1")
        .bind(event_id as i32)
        .bind(f64::from(lowest) / 100.0)
        .execute(&mut *transaction)
        .await?;
    let handed_out = match first_tier {
        Some(tier_id) if hands_out => {
            hand_out_to_everyone_going(&mut transaction, &event, tier_id, now).await?
        }
        _ => Vec::new(),
    };
    let first_tier_name = input
        .tiers
        .first()
        .map(|tier| tier.name.clone())
        .unwrap_or_default();
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
                first_tier_name.clone(),
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
    tier_id: Uuid,
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
        store::insert_free_ticket(
            &mut *connection,
            event.id,
            event_date_id,
            tier_id,
            user_id,
            &code,
        )
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

    fn tier(id: u128, price_cents: i32, capacity: Option<i32>) -> TierRow {
        TierRow {
            id: Uuid::from_u128(id),
            event_id: 42,
            name: format!("Tier {id}"),
            price_cents,
            capacity,
        }
    }

    #[test]
    fn every_tier_stays_within_the_event_limit_and_its_own() {
        let event = event_with_dates(42, &[(2026, 11, 20, 23), (2026, 11, 27, 23)]);
        let start = Utc.with_ymd_and_hms(2026, 11, 20, 12, 0, 0).unwrap();
        let tiers = [
            tier(1, 0, Some(5)),
            tier(2, 1500, None),
            tier(3, 0, Some(20)),
        ];
        let mut row = row(false);
        row.capacity = Some(10);
        // Four members' tickets and three general ones, across both dates.
        let taken = HashMap::from([(tiers[0].id, 4), (tiers[1].id, 3)]);
        let view = availability(&event, &row, &tiers, &taken, true, start);
        assert_eq!(view.remaining, Some(3));
        let left: Vec<Option<i64>> = view.tiers.iter().map(|tier| tier.remaining).collect();
        assert_eq!(left, [Some(1), Some(3), Some(3)]);
        assert_eq!(
            view.tiers
                .iter()
                .map(|tier| tier.maximum_per_order)
                .collect::<Vec<_>>(),
            [1, TICKETING.maximum_tickets_per_order, 1]
        );
        assert!(view.available);

        // Without a way to take money, only the free tiers are open.
        let unpaid = availability(&event, &row, &tiers, &taken, false, start);
        assert_eq!(
            unpaid
                .tiers
                .iter()
                .map(|tier| tier.open)
                .collect::<Vec<_>>(),
            [true, false, true]
        );

        // The event's limit reached closes every tier.
        let full = HashMap::from([(tiers[0].id, 5), (tiers[1].id, 5)]);
        let sold_out = availability(&event, &row, &tiers, &full, true, start);
        assert_eq!(sold_out.remaining, Some(0));
        assert!(sold_out.tiers.iter().all(|tier| !tier.open));
        assert!(!sold_out.available);
    }

    #[test]
    fn without_limits_nothing_runs_out() {
        let event = event_with_dates(42, &[(2026, 11, 20, 23)]);
        let start = Utc.with_ymd_and_hms(2026, 11, 20, 12, 0, 0).unwrap();
        let tiers = [tier(1, 0, None)];
        let taken = HashMap::from([(tiers[0].id, 400)]);
        let view = availability(&event, &row(false), &tiers, &taken, false, start);
        assert_eq!(view.remaining, None);
        assert_eq!(view.tiers[0].remaining, None);
        assert!(view.available);
        // Paused, or after the last date, nobody gets one.
        assert!(!availability(&event, &row(true), &tiers, &taken, false, start).available);
        let after = start + Duration::days(1);
        assert!(!availability(&event, &row(false), &tiers, &taken, false, after).available);
    }

    fn input(names: &[&str], prices: &[i32]) -> TicketingInput {
        TicketingInput {
            capacity: None,
            paused: false,
            tiers: names
                .iter()
                .zip(prices)
                .map(|(name, price)| TierInput {
                    id: None,
                    name: (*name).to_owned(),
                    price_cents: *price,
                    capacity: None,
                })
                .collect(),
        }
    }

    #[test]
    fn tiers_need_their_own_names_and_sensible_prices() {
        assert!(!check_tiers(&input(&["General"], &[0])).unwrap());
        assert!(check_tiers(&input(&["Members", "General"], &[0, 1500])).unwrap());
        let repeated = check_tiers(&input(&["General", "general"], &[0, 0]));
        assert!(matches!(
            repeated,
            Err(ApiError::Validation { detail, .. }) if detail == TICKET_TIER_NAMES_REPEAT
        ));
        let cheap = check_tiers(&input(&["General"], &[TICKETING.minimum_price_cents - 1]));
        assert!(matches!(
            cheap,
            Err(ApiError::Validation { detail, .. }) if detail == TICKET_PRICE_OUT_OF_RANGE
        ));
        let mut huge = input(&["General"], &[0]);
        huge.tiers[0].capacity = Some(TICKETING.maximum_capacity + 1);
        assert!(matches!(
            check_tiers(&huge),
            Err(ApiError::Validation { detail, .. }) if detail == TICKET_CAPACITY_TOO_HIGH
        ));
        let names: Vec<String> = (0..=TICKETING.maximum_tiers)
            .map(|n| format!("T{n}"))
            .collect();
        let names: Vec<&str> = names.iter().map(String::as_str).collect();
        let prices = vec![0; names.len()];
        assert!(matches!(
            check_tiers(&input(&names, &prices)),
            Err(ApiError::Validation { detail, .. }) if detail == TICKET_TIERS_TOO_MANY
        ));
    }
}
