//! What the ticket routes send and accept, and the rows they are built from.

use chrono::{DateTime, Utc};
use serde::Serialize;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::api::json;

/// A ticket's state: a refunded ticket no longer admits anyone.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum TicketStatus {
    Valid,
    Refunded,
}

impl TicketStatus {
    pub fn from_db(status: &str) -> Self {
        if status == "refunded" {
            Self::Refunded
        } else {
            Self::Valid
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum TicketOrderStatus {
    Pending,
    Paid,
    Expired,
    Failed,
}

impl TicketOrderStatus {
    pub fn from_db(status: &str) -> Self {
        match status {
            "paid" => Self::Paid,
            "expired" => Self::Expired,
            "failed" => Self::Failed,
            _ => Self::Pending,
        }
    }
}

/// What scanning or typing a code at the door did.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum CheckInResult {
    CheckedIn,
    AlreadyCheckedIn,
    Undone,
    Refunded,
    /// A ticket to another date of the event, which the door is not open for.
    WrongDate,
    NotForThisEvent,
    NotFound,
}

/// One date of an event with tickets, as anyone viewing the event sees it.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct TicketDateAvailability {
    #[schema(value_type = String, format = Uuid)]
    pub event_date_id: Uuid,
    #[serde(serialize_with = "json::datetime")]
    #[schema(value_type = String, format = DateTime)]
    pub dtstart_utc: DateTime<Utc>,
    #[serde(serialize_with = "json::option_datetime")]
    #[schema(value_type = Option<String>, format = DateTime, required = true)]
    pub dtend_utc: Option<DateTime<Utc>>,
    /// The date still takes tickets: it has not ended.
    pub open: bool,
}

/// One tier of an event's tickets, as anyone viewing the event sees it.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct TicketTierAvailability {
    #[schema(value_type = String, format = Uuid)]
    pub id: Uuid,
    pub name: String,
    /// Zero for a free tier: one ticket per person and date.
    pub price_cents: i32,
    /// The tier's own limit; null when only the event's limit applies.
    #[schema(required = true)]
    pub capacity: Option<i32>,
    /// Tickets left in this tier, under both its own limit and the event's;
    /// null when neither limits it.
    #[schema(required = true)]
    pub remaining: Option<i64>,
    /// The most tickets one person gets at a time: one when they are free.
    pub maximum_per_order: i32,
    /// Someone could take or buy a ticket of this tier right now.
    pub open: bool,
}

/// How people get into an event, or null when it has no tickets.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct EventTicketingResponse {
    pub event_id: i64,
    /// "cad" or "usd" once any tier is paid; null while every tier is free.
    #[schema(required = true)]
    pub currency: Option<String>,
    /// The most tickets the whole event gives out, every date and tier
    /// together; null for no limit.
    #[schema(required = true)]
    pub capacity: Option<i32>,
    /// Tickets left under the event's limit; null when it has none.
    #[schema(required = true)]
    pub remaining: Option<i64>,
    pub paused: bool,
    /// Some date and some tier are open, and the event takes tickets right now.
    pub available: bool,
    /// In the club's order.
    pub tiers: Vec<TicketTierAvailability>,
    pub dates: Vec<TicketDateAvailability>,
}

/// A club turning tickets on for its event, or changing them.
#[allow(dead_code)]
#[derive(ToSchema)]
pub struct EventTicketingUpdate {
    /// The most tickets the whole event gives out; null for no limit.
    capacity: Option<i32>,
    paused: bool,
    /// Every tier, in the order people see them. A tier left out is removed.
    tiers: Vec<TicketTierUpdate>,
}

/// One tier in a club's ticket settings.
#[allow(dead_code)]
#[derive(ToSchema)]
pub struct TicketTierUpdate {
    /// The tier being changed; null for a new one.
    #[schema(value_type = Option<String>, format = Uuid)]
    id: Option<Uuid>,
    name: String,
    /// Zero for a free tier.
    price_cents: i32,
    /// The tier's own limit; null when only the event's limit applies.
    capacity: Option<i32>,
}

#[allow(dead_code)]
#[derive(ToSchema)]
pub struct FreeTicketCreate {
    #[schema(value_type = String, format = Uuid)]
    event_date_id: Uuid,
    #[schema(value_type = String, format = Uuid)]
    tier_id: Uuid,
}

#[allow(dead_code)]
#[derive(ToSchema)]
pub struct TicketCheckoutCreate {
    #[schema(value_type = String, format = Uuid)]
    event_date_id: Uuid,
    #[schema(value_type = String, format = Uuid)]
    tier_id: Uuid,
    quantity: i32,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct TicketCheckoutResponse {
    #[schema(value_type = String, format = Uuid)]
    pub order_id: Uuid,
    pub checkout_url: String,
}

/// One admission as its holder, or a club member opening its link, sees it.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct TicketResponse {
    pub code: String,
    pub status: TicketStatus,
    /// Bought through Stripe; false for a free ticket.
    pub paid: bool,
    pub tier_name: String,
    #[serde(serialize_with = "json::option_datetime")]
    #[schema(value_type = Option<String>, format = DateTime, required = true)]
    pub checked_in_at: Option<DateTime<Utc>>,
    pub event_id: i64,
    pub event_title: String,
    #[schema(value_type = String, format = Uuid)]
    pub event_date_id: Uuid,
    #[serde(serialize_with = "json::datetime")]
    #[schema(value_type = String, format = DateTime)]
    pub dtstart_utc: DateTime<Utc>,
    #[serde(serialize_with = "json::option_datetime")]
    #[schema(value_type = Option<String>, format = DateTime, required = true)]
    pub dtend_utc: Option<DateTime<Utc>>,
    #[schema(required = true)]
    pub location: Option<String>,
    #[schema(required = true)]
    pub club_id: Option<i64>,
    #[schema(required = true)]
    pub club_name: Option<String>,
    #[schema(required = true)]
    pub school: Option<String>,
    #[schema(required = true)]
    pub image_url: Option<String>,
    /// The holder's name as anyone with the code sees it ("Ada L."), never
    /// anything from their email; `None` without a profile name.
    #[schema(required = true)]
    pub holder_name: Option<String>,
    /// The viewer is on the club's team and can admit this ticket.
    pub can_check_in: bool,
    #[serde(serialize_with = "json::option_datetime")]
    #[schema(value_type = Option<String>, format = DateTime, required = true)]
    pub refund_requested_at: Option<DateTime<Utc>>,
    #[serde(serialize_with = "json::option_datetime")]
    #[schema(value_type = Option<String>, format = DateTime, required = true)]
    pub refund_declined_at: Option<DateTime<Utc>>,
    /// The viewer bought this ticket and can still ask the club for a refund.
    pub can_request_refund: bool,
    /// The viewer holds this free ticket and can still give it back.
    pub can_return: bool,
}

/// A buyer's own checkout, polled after Stripe sends them back.
#[derive(Debug, Serialize, ToSchema)]
pub struct TicketOrderResponse {
    #[schema(value_type = String, format = Uuid)]
    pub id: Uuid,
    pub status: TicketOrderStatus,
    pub event_id: i64,
    pub quantity: i32,
    pub unit_amount_cents: i32,
    pub currency: String,
    pub tickets: Vec<TicketResponse>,
}

/// One ticket on a club's door list.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct TicketAttendee {
    #[schema(value_type = String, format = Uuid)]
    pub id: Uuid,
    pub code: String,
    pub status: TicketStatus,
    #[schema(value_type = String, format = Uuid)]
    pub event_date_id: Uuid,
    pub holder_name: String,
    pub holder_email: String,
    pub tier_name: String,
    /// When the ticket was taken or paid for.
    #[serde(serialize_with = "json::datetime")]
    #[schema(value_type = String, format = DateTime)]
    pub issued_at: DateTime<Utc>,
    #[serde(serialize_with = "json::option_datetime")]
    #[schema(value_type = Option<String>, format = DateTime, required = true)]
    pub checked_in_at: Option<DateTime<Utc>>,
    #[serde(serialize_with = "json::option_datetime")]
    #[schema(value_type = Option<String>, format = DateTime, required = true)]
    pub refunded_at: Option<DateTime<Utc>>,
    /// What the holder paid; zero for a free ticket.
    pub amount_cents: i32,
    #[serde(serialize_with = "json::option_datetime")]
    #[schema(value_type = Option<String>, format = DateTime, required = true)]
    pub refund_requested_at: Option<DateTime<Utc>>,
    #[schema(required = true)]
    pub refund_request_note: Option<String>,
    #[serde(serialize_with = "json::option_datetime")]
    #[schema(value_type = Option<String>, format = DateTime, required = true)]
    pub refund_declined_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct TicketDateCounts {
    #[schema(value_type = String, format = Uuid)]
    pub event_date_id: Uuid,
    #[serde(serialize_with = "json::datetime")]
    #[schema(value_type = String, format = DateTime)]
    pub dtstart_utc: DateTime<Utc>,
    pub issued: i64,
    pub checked_in: i64,
}

/// One tier's tickets at the club's desk.
#[derive(Debug, Serialize, ToSchema)]
pub struct TicketTierCounts {
    #[schema(value_type = String, format = Uuid)]
    pub tier_id: Uuid,
    /// Valid tickets of this tier: taken for free, or sold and not refunded.
    pub issued: i64,
    pub checked_in: i64,
    pub revenue_cents: i64,
}

/// Everything a club needs at its desk and at the door for one event.
#[derive(Debug, Serialize, ToSchema)]
pub struct EventTicketDeskResponse {
    pub ticketing: EventTicketingResponse,
    /// Valid tickets: taken for free, or sold and not refunded.
    pub issued: i64,
    pub checked_in: i64,
    pub refunded: i64,
    pub revenue_cents: i64,
    /// In the order of `ticketing.tiers`.
    pub tiers: Vec<TicketTierCounts>,
    pub dates: Vec<TicketDateCounts>,
    pub attendees: Vec<TicketAttendee>,
}

#[allow(dead_code)]
#[derive(ToSchema)]
pub struct TicketCheckInUpdate {
    checked_in: bool,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct TicketCheckInResponse {
    pub result: CheckInResult,
    #[schema(required = true)]
    pub attendee: Option<TicketAttendee>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct TicketRefundsResponse {
    pub refunded: i64,
}

/// A holder asking the club for their money back.
#[allow(dead_code)]
#[derive(ToSchema)]
pub struct TicketRefundRequestCreate {
    note: Option<String>,
}

/// Whether a club can sell tickets, and what Stripe still needs from it.
#[derive(Debug, Serialize, ToSchema)]
pub struct ClubPayoutStatus {
    /// Paid tickets are on in this environment.
    pub paid_tickets_enabled: bool,
    pub connected: bool,
    pub charges_enabled: bool,
    pub payouts_enabled: bool,
    pub details_submitted: bool,
    pub requirements_due: Vec<String>,
    pub country: String,
    pub currency: String,
}

/// One event with tickets on a club's dashboard.
#[derive(Debug, Serialize, ToSchema)]
pub struct ClubEventTicketSummary {
    pub event_id: i64,
    /// The cheapest tier's price; zero when any tier is free.
    pub lowest_price_cents: i32,
    #[schema(required = true)]
    pub currency: Option<String>,
    #[schema(required = true)]
    pub capacity: Option<i32>,
    pub paused: bool,
    pub issued: i64,
    pub checked_in: i64,
    pub revenue_cents: i64,
    /// Holders waiting for the club to refund or decline.
    pub refund_requests: i64,
}

/// A one-time Stripe page the browser opens: the club's onboarding.
#[derive(Debug, Serialize, ToSchema)]
pub struct StripeRedirectResponse {
    pub url: String,
}

/// An `event_ticketing` row.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct TicketingRow {
    pub event_id: i32,
    pub currency: Option<String>,
    pub capacity: Option<i32>,
    pub paused: bool,
}

/// A `ticket_tiers` row.
#[derive(Debug, Clone, PartialEq, Eq, sqlx::FromRow)]
pub struct TierRow {
    pub id: Uuid,
    pub event_id: i32,
    pub name: String,
    pub price_cents: i32,
    pub capacity: Option<i32>,
}

impl TierRow {
    pub fn is_free(&self) -> bool {
        self.price_cents == 0
    }
}

/// A `tickets` row with its holder and, for a paid ticket, its order.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct TicketRow {
    pub id: Uuid,
    pub event_id: i32,
    pub event_date_id: Uuid,
    pub tier_id: Uuid,
    pub tier_name: String,
    pub holder_user_id: Uuid,
    pub holder_email: String,
    pub holder_full_name: Option<String>,
    pub order_id: Option<Uuid>,
    pub code: String,
    pub status: String,
    pub checked_in_at: Option<DateTime<Utc>>,
    pub refunded_at: Option<DateTime<Utc>>,
    pub refund_requested_at: Option<DateTime<Utc>>,
    pub refund_request_note: Option<String>,
    pub refund_declined_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub unit_amount_cents: Option<i32>,
    pub currency: Option<String>,
    pub paid_at: Option<DateTime<Utc>>,
}

impl TicketRow {
    pub fn is_valid(&self) -> bool {
        self.status == "valid"
    }

    /// A holder asks once, for a valid paid ticket nobody used at the door.
    pub fn refund_requestable(&self) -> bool {
        self.order_id.is_some()
            && self.is_valid()
            && self.checked_in_at.is_none()
            && self.refund_requested_at.is_none()
            && self.refund_declined_at.is_none()
    }

    pub fn refund_waiting(&self) -> bool {
        self.refund_requested_at.is_some() && self.refund_declined_at.is_none()
    }

    /// The holder's profile name, or the name part of their email.
    pub fn holder_name(&self) -> String {
        self.holder_full_name
            .as_deref()
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .map(str::to_owned)
            .unwrap_or_else(|| {
                self.holder_email
                    .split('@')
                    .next()
                    .unwrap_or_default()
                    .to_owned()
            })
    }
}

/// A `ticket_orders` row.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct OrderRow {
    pub id: Uuid,
    pub event_id: i32,
    pub event_date_id: Uuid,
    pub tier_id: Uuid,
    pub club_id: i32,
    pub buyer_user_id: Uuid,
    pub buyer_email: String,
    pub quantity: i32,
    pub unit_amount_cents: i32,
    pub currency: String,
    pub status: String,
    pub stripe_account_id: String,
    pub stripe_checkout_session_id: Option<String>,
    pub stripe_payment_intent_id: Option<String>,
    pub reserved_until: DateTime<Utc>,
}

/// A `club_payment_accounts` row.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct PaymentAccount {
    pub club_id: i32,
    pub stripe_account_id: String,
    pub country: String,
    pub charges_enabled: bool,
    pub payouts_enabled: bool,
    pub details_submitted: bool,
    pub requirements_due: Vec<String>,
}

impl PaymentAccount {
    /// Stripe still wants something, or has not enabled charges or payouts yet.
    pub fn onboarding_unfinished(&self) -> bool {
        !(self.charges_enabled && self.payouts_enabled) || !self.requirements_due.is_empty()
    }
}
