//! Reads and writes of the ticket tables.

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use sqlx::{PgExecutor, PgPool};
use uuid::Uuid;

use super::model::{OrderRow, PaymentAccount, TicketRow, TicketingRow};
use crate::db::read_with_retry;

/// `SELECT` of `event_ticketing` with what follows it.
macro_rules! ticketing_select {
    ($rest:literal) => {
        concat!(
            "SELECT event_id, price_cents, currency, capacity, paused FROM public.event_ticketing ",
            $rest
        )
    };
}

/// A ticket with its holder's email and name, and its order's price, with what follows it.
macro_rules! ticket_select {
    ($rest:literal) => {
        concat!(
            "SELECT t.id, t.event_id, t.event_date_id, t.holder_user_id, \
             u.email AS holder_email, u.full_name AS holder_full_name, t.order_id, t.code, \
             t.status, t.checked_in_at, t.refunded_at, t.refund_requested_at, \
             t.refund_request_note, t.refund_declined_at, t.created_at, o.unit_amount_cents, \
             o.currency, o.paid_at \
             FROM public.tickets t \
             JOIN public.users u ON u.id = t.holder_user_id \
             LEFT JOIN public.ticket_orders o ON o.id = t.order_id ",
            $rest
        )
    };
}

/// `SELECT` of `ticket_orders` with what follows it.
macro_rules! order_select {
    ($rest:literal) => {
        concat!(
            "SELECT id, event_id, event_date_id, club_id, buyer_user_id, buyer_email, quantity, \
             unit_amount_cents, currency, status, stripe_account_id, \
             stripe_checkout_session_id, stripe_payment_intent_id, reserved_until \
             FROM public.ticket_orders ",
            $rest
        )
    };
}

pub async fn ticketing(db: &PgPool, event_id: i64) -> Result<Option<TicketingRow>, sqlx::Error> {
    read_with_retry(|| {
        sqlx::query_as::<_, TicketingRow>(ticketing_select!("WHERE event_id = $1"))
            .bind(event_id)
            .fetch_optional(db)
    })
    .await
}

/// The event's ticketing row, locked until the transaction ends: every change
/// to an event's tickets takes this lock first, so two people can never both
/// take the last seat.
pub async fn lock_ticketing(
    executor: impl PgExecutor<'_>,
    event_id: i64,
) -> Result<Option<TicketingRow>, sqlx::Error> {
    sqlx::query_as::<_, TicketingRow>(ticketing_select!("WHERE event_id = $1 FOR UPDATE"))
        .bind(event_id)
        .fetch_optional(executor)
        .await
}

/// Seats one date has given out: valid tickets, plus seats a buyer still holds
/// on Stripe Checkout.
pub async fn seats_taken(
    executor: impl PgExecutor<'_>,
    event_date_id: Uuid,
    now: DateTime<Utc>,
) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar::<_, i64>(
        "SELECT (SELECT count(*) FROM public.tickets \
                 WHERE event_date_id = $1 AND status = 'valid') \
              + (SELECT coalesce(sum(quantity), 0) FROM public.ticket_orders \
                 WHERE event_date_id = $1 AND status = 'pending' AND reserved_until > $2)::int8",
    )
    .bind(event_date_id)
    .bind(now)
    .fetch_one(executor)
    .await
}

/// `seats_taken` for every date of an event that has given any out.
pub async fn seats_taken_by_date(
    db: &PgPool,
    event_id: i64,
    now: DateTime<Utc>,
) -> Result<HashMap<Uuid, i64>, sqlx::Error> {
    let rows: Vec<(Uuid, i64)> = read_with_retry(|| {
        sqlx::query_as(
            "SELECT event_date_id, sum(seats)::int8 FROM ( \
                 SELECT event_date_id, count(*) AS seats FROM public.tickets \
                 WHERE event_id = $1 AND status = 'valid' GROUP BY event_date_id \
                 UNION ALL \
                 SELECT event_date_id, sum(quantity) FROM public.ticket_orders \
                 WHERE event_id = $1 AND status = 'pending' AND reserved_until > $2 \
                 GROUP BY event_date_id) AS taken \
             GROUP BY event_date_id",
        )
        .bind(event_id)
        .bind(now)
        .fetch_all(db)
    })
    .await?;
    Ok(rows.into_iter().collect())
}

/// Valid tickets per date, the floor a new capacity cannot go under.
pub async fn valid_tickets_by_date(
    executor: impl PgExecutor<'_>,
    event_id: i64,
) -> Result<HashMap<Uuid, i64>, sqlx::Error> {
    let rows: Vec<(Uuid, i64)> = sqlx::query_as(
        "SELECT event_date_id, count(*) FROM public.tickets \
         WHERE event_id = $1 AND status = 'valid' GROUP BY event_date_id",
    )
    .bind(event_id)
    .fetch_all(executor)
    .await?;
    Ok(rows.into_iter().collect())
}

/// Any ticket was ever issued for the event, or a buyer is on Checkout now.
pub async fn has_tickets_or_holds(
    executor: impl PgExecutor<'_>,
    event_id: i64,
    now: DateTime<Utc>,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM public.tickets WHERE event_id = $1) \
             OR EXISTS (SELECT 1 FROM public.ticket_orders \
                        WHERE event_id = $1 AND status = 'pending' AND reserved_until > $2)",
    )
    .bind(event_id)
    .bind(now)
    .fetch_one(executor)
    .await
}

/// Someone paid for a ticket to the event, or is paying for one now.
pub async fn has_paid_orders_or_holds(
    executor: impl PgExecutor<'_>,
    event_id: i64,
    now: DateTime<Utc>,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM public.ticket_orders WHERE event_id = $1 \
                        AND (status = 'paid' OR (status = 'pending' AND reserved_until > $2)))",
    )
    .bind(event_id)
    .bind(now)
    .fetch_one(executor)
    .await
}

/// Someone paid for, or is paying for, a ticket to one of these dates.
pub async fn dates_with_paid_orders_or_holds(
    executor: impl PgExecutor<'_>,
    event_id: i64,
    date_ids: &[Uuid],
    now: DateTime<Utc>,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM public.ticket_orders WHERE event_id = $1 \
                        AND event_date_id = ANY($2) \
                        AND (status = 'paid' OR (status = 'pending' AND reserved_until > $3)))",
    )
    .bind(event_id)
    .bind(date_ids)
    .bind(now)
    .fetch_one(executor)
    .await
}

/// Delete what pins an event's dates without holding anything: free tickets
/// and finished holds on the given dates, or on every date (`None`).
pub async fn release_dates(
    connection: &mut sqlx::PgConnection,
    event_id: i64,
    date_ids: Option<&[Uuid]>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "DELETE FROM public.tickets WHERE event_id = $1 AND order_id IS NULL \
         AND ($2::uuid[] IS NULL OR event_date_id = ANY($2))",
    )
    .bind(event_id)
    .bind(date_ids)
    .execute(&mut *connection)
    .await?;
    sqlx::query(
        "DELETE FROM public.ticket_orders WHERE event_id = $1 AND status IN ('expired', 'failed') \
         AND ($2::uuid[] IS NULL OR event_date_id = ANY($2))",
    )
    .bind(event_id)
    .bind(date_ids)
    .execute(&mut *connection)
    .await?;
    Ok(())
}

pub async fn ticket_by_code(db: &PgPool, code: &str) -> Result<Option<TicketRow>, sqlx::Error> {
    read_with_retry(|| {
        sqlx::query_as::<_, TicketRow>(ticket_select!("WHERE t.code = $1"))
            .bind(code)
            .fetch_optional(db)
    })
    .await
}

pub async fn ticket_by_id(db: &PgPool, id: Uuid) -> Result<Option<TicketRow>, sqlx::Error> {
    read_with_retry(|| {
        sqlx::query_as::<_, TicketRow>(ticket_select!("WHERE t.id = $1"))
            .bind(id)
            .fetch_optional(db)
    })
    .await
}

/// Every ticket of an event, in the order they were issued.
pub async fn tickets_for_event(db: &PgPool, event_id: i64) -> Result<Vec<TicketRow>, sqlx::Error> {
    read_with_retry(|| {
        sqlx::query_as::<_, TicketRow>(ticket_select!(
            "WHERE t.event_id = $1 ORDER BY t.created_at, t.code"
        ))
        .bind(event_id)
        .fetch_all(db)
    })
    .await
}

pub async fn tickets_for_order(db: &PgPool, order_id: Uuid) -> Result<Vec<TicketRow>, sqlx::Error> {
    read_with_retry(|| {
        sqlx::query_as::<_, TicketRow>(ticket_select!("WHERE t.order_id = $1 ORDER BY t.code"))
            .bind(order_id)
            .fetch_all(db)
    })
    .await
}

pub async fn tickets_for_holder(db: &PgPool, user_id: Uuid) -> Result<Vec<TicketRow>, sqlx::Error> {
    read_with_retry(|| {
        sqlx::query_as::<_, TicketRow>(ticket_select!(
            "WHERE t.holder_user_id = $1 ORDER BY t.created_at"
        ))
        .bind(user_id)
        .fetch_all(db)
    })
    .await
}

/// The user's free ticket for one date, if they took one.
pub async fn free_ticket(
    executor: impl PgExecutor<'_>,
    user_id: Uuid,
    event_date_id: Uuid,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT code FROM public.tickets \
         WHERE holder_user_id = $1 AND event_date_id = $2 AND order_id IS NULL",
    )
    .bind(user_id)
    .bind(event_date_id)
    .fetch_optional(executor)
    .await
}

pub async fn insert_free_ticket(
    executor: impl PgExecutor<'_>,
    event_id: i64,
    event_date_id: Uuid,
    user_id: Uuid,
    code: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO public.tickets (event_id, event_date_id, holder_user_id, code) \
         VALUES ($1, $2, $3, $4)",
    )
    .bind(event_id as i32)
    .bind(event_date_id)
    .bind(user_id)
    .bind(code)
    .execute(executor)
    .await?;
    Ok(())
}

pub async fn order(db: &PgPool, id: Uuid) -> Result<Option<OrderRow>, sqlx::Error> {
    read_with_retry(|| {
        sqlx::query_as::<_, OrderRow>(order_select!("WHERE id = $1"))
            .bind(id)
            .fetch_optional(db)
    })
    .await
}

pub async fn lock_order(
    executor: impl PgExecutor<'_>,
    id: Uuid,
) -> Result<Option<OrderRow>, sqlx::Error> {
    sqlx::query_as::<_, OrderRow>(order_select!("WHERE id = $1 FOR UPDATE"))
        .bind(id)
        .fetch_optional(executor)
        .await
}

/// An event's paid orders, oldest first.
pub async fn paid_orders(db: &PgPool, event_id: i64) -> Result<Vec<OrderRow>, sqlx::Error> {
    read_with_retry(|| {
        sqlx::query_as::<_, OrderRow>(order_select!(
            "WHERE event_id = $1 AND status = 'paid' ORDER BY created_at"
        ))
        .bind(event_id)
        .fetch_all(db)
    })
    .await
}

/// Move an order on from `from` only, so a late or repeated update never
/// undoes a newer one.
pub async fn set_order_status(
    db: &PgPool,
    id: Uuid,
    status: &str,
    from: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE public.ticket_orders SET status = $2 WHERE id = $1 AND status = $3")
        .bind(id)
        .bind(status)
        .bind(from)
        .execute(db)
        .await?;
    Ok(())
}

pub async fn payment_account(
    db: &PgPool,
    club_id: i64,
) -> Result<Option<PaymentAccount>, sqlx::Error> {
    read_with_retry(|| {
        sqlx::query_as::<_, PaymentAccount>(
            "SELECT club_id, stripe_account_id, country, charges_enabled, payouts_enabled, \
             details_submitted, requirements_due \
             FROM public.club_payment_accounts WHERE club_id = $1",
        )
        .bind(club_id)
        .fetch_optional(db)
    })
    .await
}

/// The emails of everyone on a club's team, who hear about refund requests.
pub async fn club_member_emails(db: &PgPool, club_id: i64) -> Result<Vec<String>, sqlx::Error> {
    read_with_retry(|| {
        sqlx::query_scalar::<_, String>(
            "SELECT DISTINCT u.email FROM public.club_members m \
             JOIN public.users u ON u.id = m.user_id WHERE m.club_id = $1 ORDER BY u.email",
        )
        .bind(club_id)
        .fetch_all(db)
    })
    .await
}
