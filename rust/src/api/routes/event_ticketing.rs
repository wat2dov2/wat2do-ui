//! `/events/{event_id}/ticketing`: one event's tickets. Anyone sees what is
//! left; a signed-in person takes a free ticket or starts a paid checkout;
//! the club's team turns tickets on, runs the door and refunds.

use std::sync::LazyLock;

use axum::Json;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::HeaderMap;
use axum::response::{IntoResponse, Response};
use uuid::Uuid;

use crate::api::AppState;
use crate::api::auth::{DbUser, User};
use crate::api::body::{Body, Extra, merge_issues};
use crate::api::errors::ApiError;
use crate::api::rate_limit::RateLimiter;
use crate::api::routes::events::no_content;
use crate::api::tickets::model::{
    EventTicketDeskResponse, EventTicketingResponse, EventTicketingUpdate, FreeTicketCreate,
    TicketAttendee, TicketCheckInResponse, TicketCheckInUpdate, TicketCheckoutCreate,
    TicketCheckoutResponse, TicketRefundsResponse, TicketResponse,
};
use crate::api::tickets::{admission, door, refunds, requests, ticketing};
use crate::api::validation::{Length, Limits, PathParams, Validator};
use crate::controlbox::TICKETING;

/// Per person, across taking free tickets and starting checkouts.
static LIMITER: LazyLock<RateLimiter> = LazyLock::new(|| RateLimiter::new(TICKETING.rate_limit));

fn event_id(check: &mut Validator, path: &PathParams) -> i64 {
    check.path(path, "event_id").int(Limits::default())
}

fn event_id_only(path: &PathParams) -> Result<i64, ApiError> {
    let mut check = Validator::default();
    let id = event_id(&mut check, path);
    check.finish()?;
    Ok(id)
}

fn event_and_ticket(path: &PathParams) -> Result<(i64, Uuid), ApiError> {
    let mut check = Validator::default();
    let id = event_id(&mut check, path);
    let ticket = check.path(path, "ticket_id").uuid();
    check.finish()?;
    Ok((id, ticket))
}

fn limit(user: &User) -> Result<(), ApiError> {
    LIMITER.check(&user.id.to_string())
}

#[utoipa::path(
    get,
    path = "/events/{event_id}/ticketing",
    tag = "ticketing",
    operation_id = "get_event_ticketing_events__event_id__ticketing_get",
    summary = "Get Event Ticketing",
    description = "What the event's tickets offer, or null when it has none.",
    params(("event_id" = i64, Path)),
    responses(
        (status = 200, description = "Successful Response", body = Option<EventTicketingResponse>),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn get_event_ticketing(
    State(state): State<AppState>,
    path: PathParams,
) -> Result<Json<Option<EventTicketingResponse>>, ApiError> {
    let id = event_id_only(&path)?;
    Ok(Json(ticketing::current(&state, id).await?))
}

#[utoipa::path(
    put,
    path = "/events/{event_id}/ticketing",
    tag = "ticketing",
    operation_id = "configure_event_ticketing_events__event_id__ticketing_put",
    summary = "Configure Event Ticketing",
    description = "Turn tickets on for the club's event, or change them. A price of zero gives free tickets.",
    params(("event_id" = i64, Path)),
    request_body = EventTicketingUpdate,
    responses(
        (status = 200, description = "Successful Response", body = EventTicketingResponse),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn configure_event_ticketing(
    State(state): State<AppState>,
    DbUser(user): DbUser,
    path: PathParams,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<Json<EventTicketingResponse>, ApiError> {
    let mut check = Validator::default();
    let id = event_id(&mut check, &path);
    let input = merge_issues(
        check,
        Body::parse(&bytes, &headers, Extra::Forbid).and_then(requests::ticketing),
    )?;
    Ok(Json(ticketing::configure(&state, id, input, &user).await?))
}

#[utoipa::path(
    delete,
    path = "/events/{event_id}/ticketing",
    tag = "ticketing",
    operation_id = "stop_event_ticketing_events__event_id__ticketing_delete",
    summary = "Stop Event Ticketing",
    description = "Turn tickets off for an event nobody has a ticket to yet.",
    params(("event_id" = i64, Path)),
    responses(
        (status = 204, description = "Successful Response"),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn stop_event_ticketing(
    State(state): State<AppState>,
    DbUser(user): DbUser,
    path: PathParams,
) -> Result<Response, ApiError> {
    let id = event_id_only(&path)?;
    ticketing::stop(&state, id, &user).await?;
    Ok(no_content())
}

#[utoipa::path(
    post,
    path = "/events/{event_id}/ticketing/tickets",
    tag = "ticketing",
    operation_id = "take_free_ticket_events__event_id__ticketing_tickets_post",
    summary = "Take Free Ticket",
    description = "Take the event's free ticket to one date; taking it again returns the same ticket.",
    params(("event_id" = i64, Path)),
    request_body = FreeTicketCreate,
    responses(
        (status = 200, description = "Successful Response", body = TicketResponse),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn take_free_ticket(
    State(state): State<AppState>,
    DbUser(user): DbUser,
    path: PathParams,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<Json<TicketResponse>, ApiError> {
    let mut check = Validator::default();
    let id = event_id(&mut check, &path);
    let date = merge_issues(
        check,
        Body::parse(&bytes, &headers, Extra::Forbid).and_then(requests::free_ticket),
    )?;
    limit(&user)?;
    Ok(Json(admission::take_free(&state, id, date, &user).await?))
}

#[utoipa::path(
    post,
    path = "/events/{event_id}/ticketing/checkout",
    tag = "ticketing",
    operation_id = "start_ticket_checkout_events__event_id__ticketing_checkout_post",
    summary = "Start Ticket Checkout",
    description = "Hold the seats and open Stripe Checkout on the club's account.",
    params(("event_id" = i64, Path)),
    request_body = TicketCheckoutCreate,
    responses(
        (status = 200, description = "Successful Response", body = TicketCheckoutResponse),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn start_ticket_checkout(
    State(state): State<AppState>,
    DbUser(user): DbUser,
    path: PathParams,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<Json<TicketCheckoutResponse>, ApiError> {
    let mut check = Validator::default();
    let id = event_id(&mut check, &path);
    let (date, quantity) = merge_issues(
        check,
        Body::parse(&bytes, &headers, Extra::Forbid).and_then(requests::checkout),
    )?;
    limit(&user)?;
    Ok(Json(
        admission::start_checkout(&state, id, date, quantity, &user).await?,
    ))
}

#[utoipa::path(
    get,
    path = "/events/{event_id}/ticketing/desk",
    tag = "ticketing",
    operation_id = "get_ticket_desk_events__event_id__ticketing_desk_get",
    summary = "Get Ticket Desk",
    description = "The club's counts and door list for one event.",
    params(("event_id" = i64, Path)),
    responses(
        (status = 200, description = "Successful Response", body = EventTicketDeskResponse),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn get_ticket_desk(
    State(state): State<AppState>,
    DbUser(user): DbUser,
    path: PathParams,
) -> Result<Json<EventTicketDeskResponse>, ApiError> {
    let id = event_id_only(&path)?;
    Ok(Json(door::desk(&state, id, &user).await?))
}

#[utoipa::path(
    put,
    path = "/events/{event_id}/ticketing/check-ins/{code}",
    tag = "ticketing",
    operation_id = "set_ticket_check_in_events__event_id__ticketing_check_ins__code__put",
    summary = "Set Ticket Check In",
    description = "Admit a scanned or typed ticket at the door, or undo it.",
    params(("event_id" = i64, Path), ("code" = String, Path)),
    request_body = TicketCheckInUpdate,
    responses(
        (status = 200, description = "Successful Response", body = TicketCheckInResponse),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn set_ticket_check_in(
    State(state): State<AppState>,
    DbUser(user): DbUser,
    path: PathParams,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<Json<TicketCheckInResponse>, ApiError> {
    let mut check = Validator::default();
    let id = event_id(&mut check, &path);
    let code = check.path(&path, "code").string(Length::default().max(200));
    let checked_in = merge_issues(
        check,
        Body::parse(&bytes, &headers, Extra::Forbid).and_then(requests::check_in),
    )?;
    Ok(Json(
        door::set_check_in(&state, id, &code, checked_in, &user).await?,
    ))
}

#[utoipa::path(
    post,
    path = "/events/{event_id}/ticketing/tickets/{ticket_id}/refund",
    tag = "ticketing",
    operation_id = "refund_ticket_events__event_id__ticketing_tickets__ticket_id__refund_post",
    summary = "Refund Ticket",
    params(("event_id" = i64, Path), ("ticket_id" = String, Path, format = Uuid)),
    responses(
        (status = 200, description = "Successful Response", body = TicketAttendee),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn refund_ticket(
    State(state): State<AppState>,
    DbUser(user): DbUser,
    path: PathParams,
) -> Result<Json<TicketAttendee>, ApiError> {
    let (id, ticket) = event_and_ticket(&path)?;
    Ok(Json(
        refunds::refund_ticket(&state, id, ticket, &user).await?,
    ))
}

#[utoipa::path(
    post,
    path = "/events/{event_id}/ticketing/tickets/{ticket_id}/refund-request/decline",
    tag = "ticketing",
    operation_id = "decline_ticket_refund_request_events__event_id__ticketing_tickets__ticket_id__refund_request_decline_post",
    summary = "Decline Ticket Refund Request",
    description = "The club keeps the money; the holder gets an email and keeps the ticket.",
    params(("event_id" = i64, Path), ("ticket_id" = String, Path, format = Uuid)),
    responses(
        (status = 200, description = "Successful Response", body = TicketAttendee),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn decline_ticket_refund_request(
    State(state): State<AppState>,
    DbUser(user): DbUser,
    path: PathParams,
) -> Result<Json<TicketAttendee>, ApiError> {
    let (id, ticket) = event_and_ticket(&path)?;
    Ok(Json(
        refunds::decline_request(&state, id, ticket, &user).await?,
    ))
}

#[utoipa::path(
    post,
    path = "/events/{event_id}/ticketing/refunds",
    tag = "ticketing",
    operation_id = "refund_remaining_tickets_events__event_id__ticketing_refunds_post",
    summary = "Refund Remaining Tickets",
    description = "Refund every paid ticket still valid on a cancelled event.",
    params(("event_id" = i64, Path)),
    responses(
        (status = 200, description = "Successful Response", body = TicketRefundsResponse),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn refund_remaining_tickets(
    State(state): State<AppState>,
    DbUser(user): DbUser,
    path: PathParams,
) -> Result<Response, ApiError> {
    let id = event_id_only(&path)?;
    let refunded = refunds::refund_remaining(&state, id, &user).await?;
    Ok(Json(TicketRefundsResponse { refunded }).into_response())
}
