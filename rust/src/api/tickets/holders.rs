//! Tickets as their holders see them: one ticket by its code, every ticket a
//! person holds, and an order while Stripe confirms it.

use uuid::Uuid;

use super::model::{
    TicketOrderResponse, TicketOrderStatus, TicketResponse, TicketRow, TicketStatus,
};
use super::ticketing::{closes_at, manages};
use super::{codes, store};
use crate::api::AppState;
use crate::api::auth::User;
use crate::api::errors::ApiError;
use crate::api::events::going::abbreviate;
use crate::api::events::model::Event;
use crate::api::events::store::{event_by_id, events_by_ids};
use crate::api::messages::{TICKET_NOT_FOUND, TICKET_ORDER_NOT_FOUND};

/// One ticket as `viewer` sees it; `can_check_in` when they run its club.
pub fn response(
    ticket: &TicketRow,
    event: &Event,
    viewer: Option<&User>,
    can_check_in: bool,
) -> TicketResponse {
    let occurrence = event
        .occurrences
        .iter()
        .find(|occurrence| occurrence.id == ticket.event_date_id);
    let holds = viewer.is_some_and(|viewer| viewer.id == ticket.holder_user_id);
    TicketResponse {
        code: ticket.code.clone(),
        status: TicketStatus::from_db(&ticket.status),
        paid: ticket.order_id.is_some(),
        tier_name: ticket.tier_name.clone(),
        checked_in_at: ticket.checked_in_at,
        event_id: event.id,
        event_title: event.title.clone(),
        event_date_id: ticket.event_date_id,
        dtstart_utc: occurrence
            .map(|occurrence| occurrence.dtstart_utc)
            .or_else(|| event.occurrences.first().map(|first| first.dtstart_utc))
            .unwrap_or(ticket.created_at),
        dtend_utc: occurrence.and_then(|occurrence| occurrence.dtend_utc),
        location: event.location.clone(),
        club_id: event.club_id,
        club_name: event.club.clone(),
        school: event.school.clone(),
        image_url: event.source_image_url.clone(),
        holder_name: abbreviate(ticket.holder_full_name.as_deref()),
        can_check_in,
        refund_requested_at: ticket.refund_requested_at,
        refund_declined_at: ticket.refund_declined_at,
        can_request_refund: holds && ticket.refund_requestable(),
        can_return: holds
            && ticket.order_id.is_none()
            && ticket.checked_in_at.is_none()
            && occurrence.is_some_and(|occurrence| closes_at(occurrence) > chrono::Utc::now()),
    }
}

/// Anyone holding the code sees the ticket; the club's team can also admit it.
pub async fn by_code(
    state: &AppState,
    code: &str,
    viewer: Option<&User>,
) -> Result<TicketResponse, ApiError> {
    let ticket = store::ticket_by_code(&state.db, &codes::normalize(code))
        .await?
        .ok_or_else(|| ApiError::not_found(TICKET_NOT_FOUND))?;
    let event = event_by_id(&state.db, i64::from(ticket.event_id))
        .await?
        .ok_or_else(|| ApiError::not_found(TICKET_NOT_FOUND))?;
    let can_check_in = manages(state, &event, viewer).await;
    Ok(response(&ticket, &event, viewer, can_check_in))
}

/// Every ticket the user holds, soonest date first.
pub async fn mine(state: &AppState, user: &User) -> Result<Vec<TicketResponse>, ApiError> {
    let tickets = store::tickets_for_holder(&state.db, user.id).await?;
    let event_ids: Vec<i64> = tickets
        .iter()
        .map(|ticket| i64::from(ticket.event_id))
        .collect();
    let events = events_by_ids(&state.db, &event_ids).await?;
    let mut responses: Vec<TicketResponse> = tickets
        .iter()
        .filter_map(|ticket| {
            let event = events.get(&i64::from(ticket.event_id))?;
            Some(response(ticket, event, Some(user), false))
        })
        .collect();
    responses.sort_by_key(|ticket| ticket.dtstart_utc);
    Ok(responses)
}

/// The buyer's own order, polled by the page Stripe returns them to.
pub async fn order_for_buyer(
    state: &AppState,
    order_id: Uuid,
    buyer: &User,
) -> Result<TicketOrderResponse, ApiError> {
    let order = store::order(&state.db, order_id)
        .await?
        .filter(|order| order.buyer_user_id == buyer.id)
        .ok_or_else(|| ApiError::not_found(TICKET_ORDER_NOT_FOUND))?;
    let event = event_by_id(&state.db, i64::from(order.event_id))
        .await?
        .ok_or_else(|| ApiError::not_found(TICKET_ORDER_NOT_FOUND))?;
    let tickets = store::tickets_for_order(&state.db, order_id).await?;
    Ok(TicketOrderResponse {
        id: order.id,
        status: TicketOrderStatus::from_db(&order.status),
        event_id: event.id,
        quantity: order.quantity,
        unit_amount_cents: order.unit_amount_cents,
        currency: order.currency,
        tickets: tickets
            .iter()
            .map(|ticket| response(ticket, &event, Some(buyer), false))
            .collect(),
    })
}
