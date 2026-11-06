//! Getting a ticket: a free one at once, or paid ones through Stripe Checkout
//! on the club's own account. Either way the holder is marked going, so event
//! reminders and change alerts reach them too.
//!
//! A buyer's seats are held in Postgres while they are on Checkout, and a paid
//! checkout becomes tickets exactly once however often Stripe repeats its
//! webhook.

use chrono::{DateTime, Duration, Utc};
use serde_json::{Value, json};
use uuid::Uuid;

use super::model::{OrderRow, TicketCheckoutResponse, TicketResponse, TicketingRow};
use super::stripe::{ConnectedAccount, Stripe, WebhookEvent};
use super::ticketing::refuse_unless_open;
use super::{codes, emails, holders, payouts, store};
use crate::api::AppState;
use crate::api::auth::User;
use crate::api::errors::ApiError;
use crate::api::events::going;
use crate::api::events::model::{Event, Occurrence};
use crate::api::events::store::event_by_id;
use crate::api::messages::{
    EVENT_NOT_FOUND, PAID_TICKET_NOT_RETURNABLE, TICKET_ALREADY_USED, TICKET_DATE_NOT_FOUND,
    TICKET_NOT_FOUND, TICKET_ORDER_NOT_FOUND, TICKET_QUANTITY_TOO_HIGH, TICKETS_NOT_AVAILABLE,
    TICKETS_SOLD_OUT,
};
use crate::controlbox::TICKETING;

/// Stripe measures a session's 30-minute minimum from its own clock, after this request.
const STRIPE_EXPIRY_MARGIN_MINUTES: i64 = 1;

async fn event_and_date(
    state: &AppState,
    event_id: i64,
    event_date_id: Uuid,
) -> Result<(Event, Occurrence), ApiError> {
    let event = event_by_id(&state.db, event_id)
        .await?
        .ok_or_else(|| ApiError::not_found(EVENT_NOT_FOUND))?;
    let occurrence = event
        .occurrences
        .iter()
        .find(|occurrence| occurrence.id == event_date_id)
        .cloned()
        .ok_or_else(|| ApiError::validation(TICKET_DATE_NOT_FOUND))?;
    Ok((event, occurrence))
}

/// One free ticket to one date: taking it again returns the same ticket.
pub async fn take_free(
    state: &AppState,
    event_id: i64,
    event_date_id: Uuid,
    user: &User,
) -> Result<TicketResponse, ApiError> {
    let (event, occurrence) = event_and_date(state, event_id, event_date_id).await?;
    let now = Utc::now();
    let mut transaction = state.db.begin().await?;
    let row = store::lock_ticketing(&mut *transaction, event_id)
        .await?
        .filter(TicketingRow::is_free)
        .ok_or_else(|| ApiError::validation(TICKETS_NOT_AVAILABLE))?;
    if let Some(code) = store::free_ticket(&mut *transaction, user.id, event_date_id).await? {
        drop(transaction);
        return holders::by_code(state, &code, Some(user)).await;
    }
    refuse_unless_open(&event, &row, &occurrence, now)?;
    if let Some(capacity) = row.capacity
        && store::seats_taken(&mut *transaction, event_date_id, now).await? >= i64::from(capacity)
    {
        return Err(ApiError::validation(TICKETS_SOLD_OUT));
    }
    let code = codes::new_code();
    store::insert_free_ticket(&mut *transaction, event_id, event_date_id, user.id, &code).await?;
    transaction.commit().await?;

    mark_going(state, user.id, event_id, event_date_id).await;
    emails::send_tickets(
        state.db.clone(),
        state.settings,
        event,
        occurrence,
        user.email.clone(),
        vec![code.clone()],
        None,
        format!("ticket:{code}"),
    );
    holders::by_code(state, &code, Some(user)).await
}

/// The holder gives a free ticket back, freeing the seat for someone else.
pub async fn return_free(state: &AppState, code: &str, user: &User) -> Result<(), ApiError> {
    let ticket = store::ticket_by_code(&state.db, &codes::normalize(code))
        .await?
        .filter(|ticket| ticket.holder_user_id == user.id)
        .ok_or_else(|| ApiError::not_found(TICKET_NOT_FOUND))?;
    if ticket.order_id.is_some() {
        return Err(ApiError::conflict(PAID_TICKET_NOT_RETURNABLE));
    }
    let deleted = sqlx::query(
        "DELETE FROM public.tickets WHERE id = $1 AND order_id IS NULL AND checked_in_at IS NULL",
    )
    .bind(ticket.id)
    .execute(&state.db)
    .await?
    .rows_affected();
    if deleted == 0 {
        return Err(ApiError::conflict(TICKET_ALREADY_USED));
    }
    let event_id = i64::from(ticket.event_id);
    let remaining = going::occurrence_ids(&state.db, user.id, event_id).await?;
    let kept: Vec<Uuid> = remaining
        .into_iter()
        .filter(|id| *id != ticket.event_date_id)
        .collect();
    if let Err(error) = going::set_occurrences(&state.db, user.id, event_id, &kept).await {
        tracing::info!("Returned ticket's holder still marked going: {error:?}");
    }
    Ok(())
}

/// A ticket holder is going, so reminders and change alerts reach them too.
async fn mark_going(state: &AppState, user_id: Uuid, event_id: i64, event_date_id: Uuid) {
    let mut selected = match going::occurrence_ids(&state.db, user_id, event_id).await {
        Ok(selected) => selected,
        Err(error) => {
            tracing::info!("Ticket holder {user_id} not marked going: {error:?}");
            return;
        }
    };
    if selected.contains(&event_date_id) {
        return;
    }
    selected.push(event_date_id);
    if let Err(error) = going::set_occurrences(&state.db, user_id, event_id, &selected).await {
        // The going cap, say; the ticket still admits them.
        tracing::info!("Ticket holder {user_id} not marked going: {error:?}");
    }
}

/// Hold the seats, then send the buyer to Stripe Checkout on the club's account.
pub async fn start_checkout(
    state: &AppState,
    event_id: i64,
    event_date_id: Uuid,
    quantity: i32,
    buyer: &User,
) -> Result<TicketCheckoutResponse, ApiError> {
    payouts::require_paid_tickets(state.settings)?;
    if quantity > TICKETING.maximum_tickets_per_order {
        return Err(ApiError::validation(TICKET_QUANTITY_TOO_HIGH));
    }
    let (event, occurrence) = event_and_date(state, event_id, event_date_id).await?;
    let now = Utc::now();
    let checkout_ends =
        now + Duration::minutes(TICKETING.checkout_minutes + STRIPE_EXPIRY_MARGIN_MINUTES);
    let reserved_until = checkout_ends + Duration::minutes(TICKETING.reservation_grace_minutes);
    let order = reserve(
        state,
        &event,
        &occurrence,
        quantity,
        buyer,
        reserved_until,
        now,
    )
    .await?;
    let params = checkout_params(state, &event, &occurrence, &order, checkout_ends);
    let session = match Stripe::new(state.settings)?
        .create_checkout_session(
            &order.stripe_account_id,
            &params,
            &format!("ticket-checkout-{}", order.id),
        )
        .await
    {
        Ok(session) => session,
        Err(error) => {
            // Release the seats at once instead of holding them for a checkout that never opened.
            store::set_order_status(&state.db, order.id, "failed", "pending").await?;
            return Err(error);
        }
    };
    sqlx::query("UPDATE public.ticket_orders SET stripe_checkout_session_id = $2 WHERE id = $1")
        .bind(order.id)
        .bind(&session.id)
        .execute(&state.db)
        .await?;
    Ok(TicketCheckoutResponse {
        order_id: order.id,
        checkout_url: session.url,
    })
}

async fn reserve(
    state: &AppState,
    event: &Event,
    occurrence: &Occurrence,
    quantity: i32,
    buyer: &User,
    reserved_until: DateTime<Utc>,
    now: DateTime<Utc>,
) -> Result<OrderRow, ApiError> {
    let club_id = event
        .club_id
        .ok_or_else(|| ApiError::validation(TICKETS_NOT_AVAILABLE))?;
    let account = payouts::ready_account(&state.db, club_id).await?;
    let mut transaction = state.db.begin().await?;
    let row = store::lock_ticketing(&mut *transaction, event.id)
        .await?
        .filter(|row| !row.is_free())
        .ok_or_else(|| ApiError::validation(TICKETS_NOT_AVAILABLE))?;
    refuse_unless_open(event, &row, occurrence, now)?;
    if let Some(capacity) = row.capacity
        && store::seats_taken(&mut *transaction, occurrence.id, now).await? + i64::from(quantity)
            > i64::from(capacity)
    {
        return Err(ApiError::validation(TICKETS_SOLD_OUT));
    }
    let order = sqlx::query_as::<_, OrderRow>(
        "INSERT INTO public.ticket_orders (id, event_id, event_date_id, club_id, buyer_user_id, \
         buyer_email, quantity, unit_amount_cents, currency, stripe_account_id, reserved_until) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) \
         RETURNING id, event_id, event_date_id, club_id, buyer_user_id, buyer_email, quantity, \
         unit_amount_cents, currency, status, stripe_account_id, stripe_checkout_session_id, \
         stripe_payment_intent_id, reserved_until",
    )
    .bind(Uuid::new_v4())
    .bind(event.id as i32)
    .bind(occurrence.id)
    .bind(club_id as i32)
    .bind(buyer.id)
    .bind(&buyer.email)
    .bind(quantity)
    .bind(row.price_cents)
    .bind(row.currency.as_deref().unwrap_or("cad"))
    .bind(&account.stripe_account_id)
    .bind(reserved_until)
    .fetch_one(&mut *transaction)
    .await?;
    transaction.commit().await?;
    Ok(order)
}

fn checkout_params(
    state: &AppState,
    event: &Event,
    occurrence: &Occurrence,
    order: &OrderRow,
    expires_at: DateTime<Utc>,
) -> Value {
    let site = crate::schools::frontend_url(&state.settings.frontend_url, event.school.as_deref())
        .unwrap_or_else(|_| state.settings.frontend_url.clone());
    let metadata = json!({
        "order_id": order.id.to_string(),
        "event_id": event.id.to_string(),
        "event_date_id": occurrence.id.to_string(),
    });
    let mut product = json!({"name": truncate(&event.title, 250)});
    if let Some(location) = event
        .location
        .as_deref()
        .filter(|location| !location.is_empty())
    {
        product["description"] = json!(truncate(location, 500));
    }
    if let Some(image) = event
        .source_image_url
        .as_deref()
        .filter(|url| url.starts_with("https://"))
    {
        product["images"] = json!([image]);
    }
    let club_name = event.club.as_deref().unwrap_or("wat2do");
    let mut branding = json!({"display_name": truncate(club_name, 100)});
    if let Some(logo) = event
        .club_logo_url
        .as_deref()
        .filter(|url| url.starts_with("https://"))
    {
        branding["logo"] = json!({"type": "url", "url": logo});
    }
    json!({
        "mode": "payment",
        "payment_method_types": ["card"],
        "line_items": [{
            "quantity": order.quantity,
            "price_data": {
                "currency": order.currency,
                "unit_amount": order.unit_amount_cents,
                "product_data": product,
            },
        }],
        "customer_email": order.buyer_email,
        "client_reference_id": order.id.to_string(),
        "metadata": metadata,
        "payment_intent_data": {
            "description": truncate(&format!("{} \u{d7} {}", order.quantity, event.title), 1000),
            "metadata": metadata,
        },
        "expires_at": expires_at.timestamp(),
        "success_url": format!("{site}/tickets/orders/{}", order.id),
        "cancel_url": format!("{site}/events/{}", event.id),
        "submit_type": "pay",
        "custom_text": {"submit": {"message": "Your tickets arrive by email right after you pay."}},
        "branding_settings": branding,
    })
}

fn truncate(text: &str, maximum: usize) -> String {
    text.chars().take(maximum).collect()
}

/// Apply one Connect webhook event.
pub async fn handle_webhook(state: &AppState, event: WebhookEvent) -> Result<(), ApiError> {
    let session = &event.object;
    match event.kind.as_str() {
        "checkout.session.completed" | "checkout.session.async_payment_succeeded" => {
            if session["payment_status"] != "paid" {
                return Ok(());
            }
            let Some(order_id) = known_order(state, session).await? else {
                return Ok(());
            };
            let session_id = session["id"].as_str().unwrap_or_default();
            let payment_intent = session["payment_intent"].as_str();
            if fulfil(state, order_id, session_id, payment_intent).await? {
                after_fulfilment(state, order_id).await?;
            }
        }
        "checkout.session.expired" | "checkout.session.async_payment_failed" => {
            if let Some(order_id) = known_order(state, session).await? {
                store::set_order_status(&state.db, order_id, "expired", "pending").await?;
            }
        }
        "account.updated" => {
            if let Some(account) = ConnectedAccount::from_json(session) {
                payouts::sync_account(&state.db, &account).await?;
            }
        }
        _ => {}
    }
    Ok(())
}

/// The order a Checkout session belongs to, if wat2do created it.
async fn known_order(state: &AppState, session: &Value) -> Result<Option<Uuid>, ApiError> {
    let Some(order_id) = session["client_reference_id"]
        .as_str()
        .and_then(|id| Uuid::parse_str(id).ok())
    else {
        tracing::warn!("Stripe session {} has no wat2do order", session["id"]);
        return Ok(None);
    };
    if store::order(&state.db, order_id).await?.is_none() {
        tracing::warn!(
            "Stripe session {} names unknown order {order_id}",
            session["id"]
        );
        return Ok(None);
    }
    Ok(Some(order_id))
}

/// Issue the order's tickets; true only for the delivery that issued them.
async fn fulfil(
    state: &AppState,
    order_id: Uuid,
    session_id: &str,
    payment_intent: Option<&str>,
) -> Result<bool, ApiError> {
    let mut transaction = state.db.begin().await?;
    let order = store::lock_order(&mut *transaction, order_id)
        .await?
        .ok_or_else(|| ApiError::not_found(TICKET_ORDER_NOT_FOUND))?;
    if order.status == "paid" {
        return Ok(false);
    }
    if order
        .stripe_checkout_session_id
        .as_deref()
        .is_some_and(|stored| stored != session_id)
    {
        // Stripe retries a failed delivery, so a person can look before it gives up.
        return Err(ApiError::Internal(anyhow::anyhow!(
            "Stripe session {session_id} paid for order {order_id}, which belongs to another session"
        )));
    }
    sqlx::query(
        "UPDATE public.ticket_orders SET status = 'paid', paid_at = now(), \
         stripe_payment_intent_id = $2, stripe_checkout_session_id = $3 WHERE id = $1",
    )
    .bind(order_id)
    .bind(payment_intent)
    .bind(session_id)
    .execute(&mut *transaction)
    .await?;
    let codes: Vec<String> = (0..order.quantity).map(|_| codes::new_code()).collect();
    sqlx::query(
        "INSERT INTO public.tickets (order_id, event_id, event_date_id, holder_user_id, code) \
         SELECT $1, $2, $3, $4, code FROM unnest($5::text[]) AS code",
    )
    .bind(order_id)
    .bind(order.event_id)
    .bind(order.event_date_id)
    .bind(order.buyer_user_id)
    .bind(&codes)
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;
    Ok(true)
}

/// Mark the buyer going and send the receipt, once per order.
async fn after_fulfilment(state: &AppState, order_id: Uuid) -> Result<(), ApiError> {
    let claimed: Option<Uuid> = sqlx::query_scalar(
        "UPDATE public.ticket_orders SET confirmation_sent_at = now() \
         WHERE id = $1 AND confirmation_sent_at IS NULL RETURNING id",
    )
    .bind(order_id)
    .fetch_optional(&state.db)
    .await?;
    if claimed.is_none() {
        return Ok(());
    }
    let Some(order) = store::order(&state.db, order_id).await? else {
        return Ok(());
    };
    let event_id = i64::from(order.event_id);
    mark_going(state, order.buyer_user_id, event_id, order.event_date_id).await;
    let Some(event) = event_by_id(&state.db, event_id).await? else {
        tracing::error!("Paid order {order_id} has no event to confirm");
        return Ok(());
    };
    let Some(occurrence) = event
        .occurrences
        .iter()
        .find(|occurrence| occurrence.id == order.event_date_id)
        .cloned()
    else {
        tracing::error!("Paid order {order_id} has no date to confirm");
        return Ok(());
    };
    let codes = store::tickets_for_order(&state.db, order_id)
        .await?
        .into_iter()
        .map(|ticket| ticket.code)
        .collect();
    emails::send_tickets(
        state.db.clone(),
        state.settings,
        event,
        occurrence,
        order.buyer_email.clone(),
        codes,
        Some((order.unit_amount_cents, order.currency.clone())),
        format!("ticket-confirmation:{order_id}"),
    );
    Ok(())
}
