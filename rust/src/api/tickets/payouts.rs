//! Connecting a club's Stripe Express account, so the club can sell tickets.
//!
//! Each club has at most one account, created the first time a member starts
//! onboarding. The app never replaces it, so no member can redirect a club's
//! payouts; only Stripe's own onboarding collects bank and identity details.

use sqlx::PgPool;

use super::model::{ClubPayoutStatus, PaymentAccount};
use super::store;
use super::stripe::{ConnectedAccount, Stripe};
use crate::api::AppState;
use crate::api::auth::User;
use crate::api::errors::ApiError;
use crate::api::messages::{CLUB_PENDING_REVIEW, PAID_TICKETS_DISABLED, PAYOUTS_NOT_READY};
use crate::api::routes::clubs::ClubResponse;
use crate::controlbox::TICKETING;
use crate::db::read_with_retry;
use crate::settings::Settings;

/// Where Stripe sends a member back after onboarding, in the club panel.
const PAYOUTS_PATH: &str = "/club-panel/payouts";
const DEFAULT_COUNTRY: &str = "CA";

/// Paid tickets are switched on, and this environment has Stripe's key and
/// the Connect webhook that confirms payments.
pub fn paid_tickets_available(settings: &Settings) -> bool {
    TICKETING.paid_tickets_enabled
        && !settings.stripe_secret_key.is_empty()
        && !settings.stripe_webhook_secret.is_empty()
}

pub fn require_paid_tickets(settings: &Settings) -> Result<(), ApiError> {
    if paid_tickets_available(settings) {
        Ok(())
    } else {
        Err(ApiError::validation(PAID_TICKETS_DISABLED))
    }
}

/// A school's country picks its clubs' Stripe account country and currency.
pub async fn school_country(db: &PgPool, school: Option<&str>) -> Result<String, ApiError> {
    let Some(school) = school else {
        return Ok(DEFAULT_COUNTRY.to_owned());
    };
    let country: Option<String> = read_with_retry(|| {
        sqlx::query_scalar("SELECT country FROM public.schools WHERE slug = $1")
            .bind(school)
            .fetch_optional(db)
    })
    .await?;
    Ok(country.unwrap_or_else(|| DEFAULT_COUNTRY.to_owned()))
}

pub fn currency(country: &str) -> String {
    TICKETING
        .currency_by_country
        .get(country)
        .cloned()
        .unwrap_or_else(|| TICKETING.currency_by_country[DEFAULT_COUNTRY].clone())
}

/// The club's account, once Stripe lets it take payments.
pub async fn ready_account(db: &PgPool, club_id: i64) -> Result<PaymentAccount, ApiError> {
    store::payment_account(db, club_id)
        .await?
        .filter(|account| account.charges_enabled)
        .ok_or_else(|| ApiError::validation(PAYOUTS_NOT_READY))
}

/// The club's payout state, refreshed from Stripe while onboarding is unfinished
/// (Stripe's `account.updated` webhook keeps it current otherwise).
pub async fn status(state: &AppState, club: &ClubResponse) -> Result<ClubPayoutStatus, ApiError> {
    let country = school_country(&state.db, club.school.as_deref()).await?;
    let mut account = store::payment_account(&state.db, club.id.into()).await?;
    if let Some(stored) = account
        .as_ref()
        .filter(|stored| stored.onboarding_unfinished())
        && paid_tickets_available(state.settings)
    {
        // A Stripe outage shows the stored state instead of failing the page.
        let fresh = match Stripe::new(state.settings)?
            .retrieve_account(&stored.stripe_account_id)
            .await
        {
            Ok(fresh) => store_account(&state.db, &fresh).await?,
            Err(_) => None,
        };
        account = fresh.or(account);
    }
    Ok(ClubPayoutStatus {
        paid_tickets_enabled: paid_tickets_available(state.settings),
        connected: account.is_some(),
        charges_enabled: account
            .as_ref()
            .is_some_and(|account| account.charges_enabled),
        payouts_enabled: account
            .as_ref()
            .is_some_and(|account| account.payouts_enabled),
        details_submitted: account
            .as_ref()
            .is_some_and(|account| account.details_submitted),
        requirements_due: account
            .map(|account| account.requirements_due)
            .unwrap_or_default(),
        currency: currency(&country),
        country,
    })
}

/// Stripe's hosted onboarding for the club, creating its account on first use.
pub async fn onboarding_url(
    state: &AppState,
    club: &ClubResponse,
    member: &User,
) -> Result<String, ApiError> {
    require_paid_tickets(state.settings)?;
    if club.status != "approved" {
        return Err(ApiError::authorization(CLUB_PENDING_REVIEW));
    }
    let stripe = Stripe::new(state.settings)?;
    let account = match store::payment_account(&state.db, club.id.into()).await? {
        Some(account) => account,
        None => connect_new_account(state, &stripe, club, member).await?,
    };
    let panel = format!("{}{PAYOUTS_PATH}", club_site(state, club)?);
    stripe
        .onboarding_link(
            &account.stripe_account_id,
            &format!("{panel}?onboarding=refresh"),
            &format!("{panel}?onboarding=returned"),
        )
        .await
}

/// A one-time login to the club's Stripe Express dashboard.
pub async fn dashboard_url(state: &AppState, club: &ClubResponse) -> Result<String, ApiError> {
    require_paid_tickets(state.settings)?;
    let account = store::payment_account(&state.db, club.id.into())
        .await?
        .filter(|account| account.details_submitted)
        .ok_or_else(|| ApiError::validation(PAYOUTS_NOT_READY))?;
    Stripe::new(state.settings)?
        .dashboard_link(&account.stripe_account_id)
        .await
}

/// Apply Stripe's latest view of an account, as `account.updated` reports it.
pub async fn sync_account(db: &PgPool, account: &ConnectedAccount) -> Result<(), ApiError> {
    if store_account(db, account).await?.is_none() {
        tracing::warn!(
            "Stripe reported an account wat2do does not know: {}",
            account.id
        );
    }
    Ok(())
}

async fn connect_new_account(
    state: &AppState,
    stripe: &Stripe<'_>,
    club: &ClubResponse,
    member: &User,
) -> Result<PaymentAccount, ApiError> {
    let country = school_country(&state.db, club.school.as_deref()).await?;
    let site = club_site(state, club)?;
    // Stripe's idempotency key is the club, so two members starting at once
    // share one account; the first row stored wins.
    let created = stripe
        .create_express_account(
            club.id.into(),
            &club.club_name,
            &format!("{site}/clubs/{}", club.id),
            &country,
            &member.email,
        )
        .await?;
    sqlx::query(
        "INSERT INTO public.club_payment_accounts (club_id, stripe_account_id, country, \
         charges_enabled, payouts_enabled, details_submitted, requirements_due, connected_by) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (club_id) DO NOTHING",
    )
    .bind(club.id)
    .bind(&created.id)
    .bind(&country)
    .bind(created.charges_enabled)
    .bind(created.payouts_enabled)
    .bind(created.details_submitted)
    .bind(&created.requirements_due)
    .bind(member.id)
    .execute(&state.db)
    .await?;
    store::payment_account(&state.db, club.id.into())
        .await?
        .ok_or_else(|| {
            ApiError::Internal(anyhow::anyhow!(
                "payment account for club {} was not stored",
                club.id
            ))
        })
}

async fn store_account(
    db: &PgPool,
    account: &ConnectedAccount,
) -> Result<Option<PaymentAccount>, ApiError> {
    Ok(sqlx::query_as::<_, PaymentAccount>(
        "UPDATE public.club_payment_accounts SET charges_enabled = $2, payouts_enabled = $3, \
         details_submitted = $4, requirements_due = $5 WHERE stripe_account_id = $1 \
         RETURNING club_id, stripe_account_id, country, charges_enabled, payouts_enabled, \
         details_submitted, requirements_due",
    )
    .bind(&account.id)
    .bind(account.charges_enabled)
    .bind(account.payouts_enabled)
    .bind(account.details_submitted)
    .bind(&account.requirements_due)
    .fetch_optional(db)
    .await?)
}

fn club_site(state: &AppState, club: &ClubResponse) -> Result<String, ApiError> {
    Ok(crate::schools::frontend_url(
        &state.settings.frontend_url,
        club.school.as_deref(),
    )?)
}
