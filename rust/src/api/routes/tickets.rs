//! `/tickets`: tickets as their holders see them. Anyone with a ticket's link
//! sees it; a member of the club running the event can also admit it there.

use axum::Json;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::HeaderMap;
use axum::response::Response;

use crate::api::AppState;
use crate::api::auth::{DbUser, OptionalUser, find_user};
use crate::api::body::{Body, Extra, merge_issues};
use crate::api::errors::ApiError;
use crate::api::routes::events::no_content;
use crate::api::tickets::model::{TicketOrderResponse, TicketRefundRequestCreate, TicketResponse};
use crate::api::tickets::{admission, holders, refunds, requests};
use crate::api::validation::{Length, PathParams, Validator};

/// Codes are 24 characters; a scanned link is longer, and is read down to its code.
const CODE_MAX_LENGTH: usize = 200;

fn code(path: &PathParams) -> Result<String, ApiError> {
    let mut check = Validator::default();
    let code = check
        .path(path, "code")
        .string(Length::default().max(CODE_MAX_LENGTH));
    check.finish()?;
    Ok(code)
}

#[utoipa::path(
    get,
    path = "/tickets/mine",
    tag = "tickets",
    operation_id = "list_my_tickets_tickets_mine_get",
    summary = "List My Tickets",
    description = "Every ticket the user holds, soonest date first.",
    responses((status = 200, description = "Successful Response", body = Vec<TicketResponse>))
)]
pub async fn list_my_tickets(
    State(state): State<AppState>,
    DbUser(user): DbUser,
) -> Result<Json<Vec<TicketResponse>>, ApiError> {
    Ok(Json(holders::mine(&state, &user).await?))
}

#[utoipa::path(
    get,
    path = "/tickets/orders/{order_id}",
    tag = "tickets",
    operation_id = "get_my_ticket_order_tickets_orders__order_id__get",
    summary = "Get My Ticket Order",
    description = "The buyer's own order, polled while Stripe confirms the payment.",
    params(("order_id" = String, Path, format = Uuid)),
    responses(
        (status = 200, description = "Successful Response", body = TicketOrderResponse),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn get_my_ticket_order(
    State(state): State<AppState>,
    DbUser(user): DbUser,
    path: PathParams,
) -> Result<Json<TicketOrderResponse>, ApiError> {
    let mut check = Validator::default();
    let order_id = check.path(&path, "order_id").uuid();
    check.finish()?;
    Ok(Json(
        holders::order_for_buyer(&state, order_id, &user).await?,
    ))
}

#[utoipa::path(
    get,
    path = "/tickets/{code}",
    tag = "tickets",
    operation_id = "get_ticket_tickets__code__get",
    summary = "Get Ticket",
    description = "Anyone with the code sees the ticket; the club's team can also admit it.",
    params(("code" = String, Path)),
    responses(
        (status = 200, description = "Successful Response", body = TicketResponse),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn get_ticket(
    State(state): State<AppState>,
    OptionalUser(auth): OptionalUser,
    path: PathParams,
) -> Result<Json<TicketResponse>, ApiError> {
    let code = code(&path)?;
    let viewer = match auth {
        Some(auth) => find_user(&state.db, &auth.id).await?,
        None => None,
    };
    Ok(Json(
        holders::by_code(&state, &code, viewer.as_ref()).await?,
    ))
}

#[utoipa::path(
    delete,
    path = "/tickets/{code}",
    tag = "tickets",
    operation_id = "return_ticket_tickets__code__delete",
    summary = "Return Ticket",
    description = "Give a free ticket back, so someone else can take the seat.",
    params(("code" = String, Path)),
    responses(
        (status = 204, description = "Successful Response"),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn return_ticket(
    State(state): State<AppState>,
    DbUser(user): DbUser,
    path: PathParams,
) -> Result<Response, ApiError> {
    let code = code(&path)?;
    admission::return_free(&state, &code, &user).await?;
    Ok(no_content())
}

#[utoipa::path(
    post,
    path = "/tickets/{code}/refund-request",
    tag = "tickets",
    operation_id = "request_ticket_refund_tickets__code__refund_request_post",
    summary = "Request Ticket Refund",
    description = "The holder asks the club for a refund; everyone on the club's team gets an email.",
    params(("code" = String, Path)),
    request_body = TicketRefundRequestCreate,
    responses(
        (status = 200, description = "Successful Response", body = TicketResponse),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn request_ticket_refund(
    State(state): State<AppState>,
    DbUser(user): DbUser,
    path: PathParams,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<Json<TicketResponse>, ApiError> {
    let mut check = Validator::default();
    let code = check
        .path(&path, "code")
        .string(Length::default().max(CODE_MAX_LENGTH));
    let note = merge_issues(
        check,
        Body::parse(&bytes, &headers, Extra::Forbid).and_then(requests::refund_request),
    )?;
    Ok(Json(
        refunds::request_refund(&state, &code, &user, note).await?,
    ))
}
