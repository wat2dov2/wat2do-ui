//! Refunds of paid tickets: a club refunding one, a holder asking for one
//! (every member of the club hears about it, and the holder hears back either
//! way), and every ticket of a cancelled event. Each refund is a refund of
//! the club's own Stripe charge.

use sha2::{Digest, Sha256};
use uuid::Uuid;

use super::door::attendee;
use super::model::{OrderRow, TicketAttendee, TicketResponse, TicketRow};
use super::stripe::Stripe;
use super::ticketing::{managed_event, manages};
use super::{codes, emails, holders, store};
use crate::api::AppState;
use crate::api::auth::User;
use crate::api::errors::ApiError;
use crate::api::events::store::event_by_id;
use crate::api::messages::{
    EVENT_NOT_FOUND, FREE_TICKET_NOT_REFUNDABLE, TICKET_ALREADY_REFUNDED, TICKET_ALREADY_USED,
    TICKET_NOT_FOUND, TICKET_REFUND_ALREADY_DECLINED, TICKET_REFUND_NOT_REQUESTED,
    TICKET_REFUNDS_NEED_CANCELLATION,
};

/// The event's ticket, refundable: paid and not refunded yet.
async fn paid_ticket(
    state: &AppState,
    event_id: i64,
    ticket_id: Uuid,
) -> Result<(TicketRow, OrderRow), ApiError> {
    let ticket = store::ticket_by_id(&state.db, ticket_id)
        .await?
        .filter(|ticket| i64::from(ticket.event_id) == event_id)
        .ok_or_else(|| ApiError::not_found(TICKET_NOT_FOUND))?;
    if !ticket.is_valid() {
        return Err(ApiError::conflict(TICKET_ALREADY_REFUNDED));
    }
    let order_id = ticket
        .order_id
        .ok_or_else(|| ApiError::validation(FREE_TICKET_NOT_REFUNDABLE))?;
    let order = store::order(&state.db, order_id)
        .await?
        .ok_or_else(|| ApiError::not_found(TICKET_NOT_FOUND))?;
    Ok((ticket, order))
}

pub async fn refund_ticket(
    state: &AppState,
    event_id: i64,
    ticket_id: Uuid,
    manager: &User,
) -> Result<TicketAttendee, ApiError> {
    let event = managed_event(state, event_id, manager).await?;
    let (ticket, order) = paid_ticket(state, event_id, ticket_id).await?;
    refund(
        state,
        &order,
        &[ticket.id],
        Some(manager.id),
        &format!("ticket-refund-{ticket_id}"),
    )
    .await?;
    emails::send_refund_notice(
        state.settings,
        &event,
        &order.buyer_email,
        1,
        i64::from(order.unit_amount_cents),
        &order.currency,
        false,
    );
    let refunded = store::ticket_by_id(&state.db, ticket_id)
        .await?
        .ok_or_else(|| ApiError::not_found(TICKET_NOT_FOUND))?;
    Ok(attendee(&refunded))
}

/// The holder asks the club for their money back. Asking again changes
/// nothing and emails nobody twice.
pub async fn request_refund(
    state: &AppState,
    code: &str,
    holder: &User,
    note: Option<String>,
) -> Result<TicketResponse, ApiError> {
    let ticket = store::ticket_by_code(&state.db, &codes::normalize(code))
        .await?
        .filter(|ticket| ticket.holder_user_id == holder.id)
        .ok_or_else(|| ApiError::not_found(TICKET_NOT_FOUND))?;
    if ticket.order_id.is_none() {
        return Err(ApiError::validation(FREE_TICKET_NOT_REFUNDABLE));
    }
    if !ticket.is_valid() {
        return Err(ApiError::conflict(TICKET_ALREADY_REFUNDED));
    }
    if ticket.checked_in_at.is_some() {
        return Err(ApiError::conflict(TICKET_ALREADY_USED));
    }
    if ticket.refund_declined_at.is_some() {
        return Err(ApiError::conflict(TICKET_REFUND_ALREADY_DECLINED));
    }
    let event = event_by_id(&state.db, i64::from(ticket.event_id))
        .await?
        .ok_or_else(|| ApiError::not_found(TICKET_NOT_FOUND))?;
    let note = note
        .map(|note| note.trim().to_owned())
        .filter(|note| !note.is_empty());
    let claimed = sqlx::query(
        "UPDATE public.tickets SET refund_requested_at = now(), refund_request_note = $2 \
         WHERE id = $1 AND status = 'valid' AND refund_requested_at IS NULL",
    )
    .bind(ticket.id)
    .bind(&note)
    .execute(&state.db)
    .await?
    .rows_affected();
    if claimed > 0 {
        let recipients = match event.club_id {
            Some(club_id) => store::club_member_emails(&state.db, club_id).await?,
            None => Vec::new(),
        };
        emails::send_refund_request(
            state.settings,
            &event,
            recipients,
            &ticket.holder_name(),
            i64::from(ticket.unit_amount_cents.unwrap_or(0)),
            ticket.currency.as_deref().unwrap_or_default(),
            note.as_deref(),
            ticket.id,
        );
    }
    let can_check_in = manages(state, &event, Some(holder)).await;
    let updated = store::ticket_by_id(&state.db, ticket.id)
        .await?
        .ok_or_else(|| ApiError::not_found(TICKET_NOT_FOUND))?;
    Ok(holders::response(
        &updated,
        &event,
        Some(holder),
        can_check_in,
    ))
}

/// The club says no: the holder hears about it and keeps their ticket.
pub async fn decline_request(
    state: &AppState,
    event_id: i64,
    ticket_id: Uuid,
    manager: &User,
) -> Result<TicketAttendee, ApiError> {
    let event = managed_event(state, event_id, manager).await?;
    let (ticket, order) = paid_ticket(state, event_id, ticket_id).await?;
    if ticket.refund_requested_at.is_none() {
        return Err(ApiError::conflict(TICKET_REFUND_NOT_REQUESTED));
    }
    let declined = sqlx::query(
        "UPDATE public.tickets SET refund_declined_at = now() \
         WHERE id = $1 AND refund_declined_at IS NULL",
    )
    .bind(ticket_id)
    .execute(&state.db)
    .await?
    .rows_affected();
    if declined > 0 {
        emails::send_refund_declined(state.settings, &event, &order.buyer_email, &ticket.code);
    }
    let updated = store::ticket_by_id(&state.db, ticket_id)
        .await?
        .ok_or_else(|| ApiError::not_found(TICKET_NOT_FOUND))?;
    Ok(attendee(&updated))
}

/// Finish refunding a cancelled event, e.g. after Stripe was briefly unreachable.
pub async fn refund_remaining(
    state: &AppState,
    event_id: i64,
    manager: &User,
) -> Result<i64, ApiError> {
    let event = managed_event(state, event_id, manager).await?;
    if !event.cancelled {
        return Err(ApiError::validation(TICKET_REFUNDS_NEED_CANCELLATION));
    }
    refund_cancelled_event(state, event_id, Some(manager.id)).await
}

/// Refund every paid ticket of a cancelled event in the background, after the
/// cancellation is answered.
pub fn refund_cancelled_in_background(state: AppState, event_id: i64, refunded_by: Option<Uuid>) {
    tokio::spawn(async move {
        if let Err(error) = refund_cancelled_event(&state, event_id, refunded_by).await {
            tracing::error!("Refunding cancelled event {event_id} failed: {error:?}");
        }
    });
}

/// Refund every valid paid ticket of a cancelled event, one refund per order.
/// Each order is tried on its own, so one failure never blocks the rest;
/// calling again finishes whatever is left. Returns the tickets refunded.
pub async fn refund_cancelled_event(
    state: &AppState,
    event_id: i64,
    refunded_by: Option<Uuid>,
) -> Result<i64, ApiError> {
    let event = event_by_id(&state.db, event_id)
        .await?
        .ok_or_else(|| ApiError::not_found(EVENT_NOT_FOUND))?;
    let tickets = store::tickets_for_event(&state.db, event_id).await?;
    let mut refunded = 0;
    for order in store::paid_orders(&state.db, event_id).await? {
        let valid: Vec<Uuid> = tickets
            .iter()
            .filter(|ticket| ticket.order_id == Some(order.id) && ticket.is_valid())
            .map(|ticket| ticket.id)
            .collect();
        if valid.is_empty() {
            continue;
        }
        // The same set of tickets always refunds under the same key.
        let mut ids: Vec<String> = valid.iter().map(Uuid::to_string).collect();
        ids.sort();
        let digest = hex::encode(Sha256::digest(ids.join(",").as_bytes()));
        let key = format!("order-refund-{}-{}", order.id, &digest[..16]);
        if refund(state, &order, &valid, refunded_by, &key)
            .await
            .is_err()
        {
            tracing::error!(
                "Could not refund order {} of cancelled event {event_id}",
                order.id
            );
            continue;
        }
        refunded += valid.len() as i64;
        emails::send_refund_notice(
            state.settings,
            &event,
            &order.buyer_email,
            valid.len(),
            i64::from(order.unit_amount_cents) * valid.len() as i64,
            &order.currency,
            true,
        );
    }
    Ok(refunded)
}

async fn refund(
    state: &AppState,
    order: &OrderRow,
    ticket_ids: &[Uuid],
    refunded_by: Option<Uuid>,
    key: &str,
) -> Result<(), ApiError> {
    let payment_intent = order.stripe_payment_intent_id.as_deref().ok_or_else(|| {
        ApiError::Internal(anyhow::anyhow!("paid order {} has no payment", order.id))
    })?;
    let refund_id = Stripe::new(state.settings)?
        .refund(
            &order.stripe_account_id,
            payment_intent,
            i64::from(order.unit_amount_cents) * ticket_ids.len() as i64,
            key,
            &serde_json::json!({
                "order_id": order.id.to_string(),
                "event_id": order.event_id.to_string(),
            }),
        )
        .await?;
    sqlx::query(
        "UPDATE public.tickets SET status = 'refunded', refunded_at = now(), refunded_by = $2, \
         stripe_refund_id = $3 WHERE id = ANY($1) AND status = 'valid'",
    )
    .bind(ticket_ids)
    .bind(refunded_by)
    .bind(&refund_id)
    .execute(&state.db)
    .await?;
    Ok(())
}
