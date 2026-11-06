//! The one place wat2do talks to Stripe.
//!
//! Clubs are Stripe Connect Express accounts, and every charge is a direct
//! charge on the club's own account. Each call that touches money therefore
//! names that connected account (`Stripe-Account`), so a checkout or a refund
//! can only ever reach the right club's money. Every write carries an
//! idempotency key, so a retry never charges, refunds or creates twice.
//! Callers get plain values back, never Stripe's objects.

use std::sync::LazyLock;
use std::time::Duration;

use axum::http::StatusCode;
use hmac::{Hmac, Mac};
use serde_json::{Map, Value, json};
use sha2::Sha256;

use crate::api::errors::ApiError;
use crate::api::messages::{
    PAID_TICKETS_DISABLED, PAYMENT_PROVIDER_UNAVAILABLE, STRIPE_SIGNATURE_INVALID,
};
use crate::controlbox::TICKETING;
use crate::settings::Settings;

const API: &str = "https://api.stripe.com/v1";

static CLIENT: LazyLock<wreq::Client> = LazyLock::new(|| {
    wreq::Client::builder()
        .timeout(Duration::from_secs_f64(TICKETING.stripe_timeout_seconds))
        .build()
        .expect("the Stripe HTTP client builds")
});

/// A club's Stripe account, as wat2do keeps it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConnectedAccount {
    pub id: String,
    pub charges_enabled: bool,
    pub payouts_enabled: bool,
    pub details_submitted: bool,
    pub requirements_due: Vec<String>,
}

impl ConnectedAccount {
    /// An account as the API returns it, or as an `account.updated` event carries it.
    pub fn from_json(account: &Value) -> Option<Self> {
        let flag = |name: &str| account[name].as_bool().unwrap_or(false);
        let requirements = &account["requirements"];
        let mut due: Vec<String> = ["past_due", "currently_due"]
            .iter()
            .flat_map(|list| requirements[list].as_array().cloned().unwrap_or_default())
            .filter_map(|item| item.as_str().map(str::to_owned))
            .collect();
        due.sort();
        due.dedup();
        Some(Self {
            id: account["id"].as_str()?.to_owned(),
            charges_enabled: flag("charges_enabled"),
            payouts_enabled: flag("payouts_enabled"),
            details_submitted: flag("details_submitted"),
            requirements_due: due,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CheckoutSession {
    pub id: String,
    pub url: String,
}

/// One webhook event, once its signature proved it came from Stripe.
#[derive(Debug, Clone, PartialEq)]
pub struct WebhookEvent {
    pub kind: String,
    pub object: Value,
}

/// The platform's API key, for one request at a time.
pub struct Stripe<'a> {
    secret_key: &'a str,
}

impl<'a> Stripe<'a> {
    /// Stripe, when this environment has its key; otherwise paid tickets are off.
    pub fn new(settings: &'a Settings) -> Result<Self, ApiError> {
        if settings.stripe_secret_key.is_empty() {
            return Err(ApiError::validation(PAID_TICKETS_DISABLED));
        }
        Ok(Self {
            secret_key: &settings.stripe_secret_key,
        })
    }

    /// A new Express account for one club; Stripe collects every requirement itself.
    pub async fn create_express_account(
        &self,
        club_id: i64,
        club_name: &str,
        club_url: &str,
        country: &str,
        email: &str,
    ) -> Result<ConnectedAccount, ApiError> {
        let params = json!({
            "controller": {
                "stripe_dashboard": {"type": "express"},
                "fees": {"payer": "application"},
                "losses": {"payments": "application"},
                "requirement_collection": "stripe",
            },
            "country": country,
            "email": email,
            "capabilities": {
                "card_payments": {"requested": true},
                "transfers": {"requested": true},
            },
            "business_profile": {
                "name": club_name,
                "url": club_url,
                "product_description": "Tickets to student club events sold on wat2do",
            },
            "metadata": {"club_id": club_id.to_string()},
        });
        let key = format!("club-account-{club_id}");
        let account = self
            .post("/accounts", &params, None, &key, "account creation")
            .await?;
        account_from(&account)
    }

    pub async fn retrieve_account(&self, account_id: &str) -> Result<ConnectedAccount, ApiError> {
        let account = self
            .send(
                wreq::Method::GET,
                &format!("/accounts/{account_id}"),
                None,
                None,
                None,
                "account retrieval",
            )
            .await?;
        account_from(&account)
    }

    /// Stripe's hosted onboarding, asking for everything up front so it is done once.
    pub async fn onboarding_link(
        &self,
        account_id: &str,
        refresh_url: &str,
        return_url: &str,
    ) -> Result<String, ApiError> {
        let params = json!({
            "account": account_id,
            "type": "account_onboarding",
            "refresh_url": refresh_url,
            "return_url": return_url,
            "collection_options": {"fields": "eventually_due"},
        });
        // Each link is single-use, so each request gets its own.
        let key = format!("onboarding-link-{}", crate::api::secrets::token_urlsafe(12));
        let link = self
            .post("/account_links", &params, None, &key, "onboarding link")
            .await?;
        string_field(&link, "url")
    }

    /// A one-time login to the club's Express dashboard: balances and payouts.
    pub async fn dashboard_link(&self, account_id: &str) -> Result<String, ApiError> {
        let key = format!("dashboard-link-{}", crate::api::secrets::token_urlsafe(12));
        let link = self
            .post(
                &format!("/accounts/{account_id}/login_links"),
                &json!({}),
                None,
                &key,
                "dashboard link",
            )
            .await?;
        string_field(&link, "url")
    }

    pub async fn create_checkout_session(
        &self,
        account_id: &str,
        params: &Value,
        idempotency_key: &str,
    ) -> Result<CheckoutSession, ApiError> {
        let session = self
            .post(
                "/checkout/sessions",
                params,
                Some(account_id),
                idempotency_key,
                "checkout creation",
            )
            .await?;
        Ok(CheckoutSession {
            id: string_field(&session, "id")?,
            url: string_field(&session, "url")?,
        })
    }

    /// Refund part of a club's payment; the same key never refunds twice.
    pub async fn refund(
        &self,
        account_id: &str,
        payment_intent_id: &str,
        amount_cents: i64,
        idempotency_key: &str,
        metadata: &Value,
    ) -> Result<String, ApiError> {
        let params = json!({
            "payment_intent": payment_intent_id,
            "amount": amount_cents,
            "metadata": metadata,
        });
        let refund = self
            .post(
                "/refunds",
                &params,
                Some(account_id),
                idempotency_key,
                "refund",
            )
            .await?;
        string_field(&refund, "id")
    }

    async fn post(
        &self,
        path: &str,
        params: &Value,
        account: Option<&str>,
        idempotency_key: &str,
        action: &str,
    ) -> Result<Value, ApiError> {
        self.send(
            wreq::Method::POST,
            path,
            Some(params),
            account,
            Some(idempotency_key),
            action,
        )
        .await
    }

    /// One API call, retried while Stripe says a retry may succeed. A failure
    /// is logged with Stripe's own message and shown as one calm message.
    async fn send(
        &self,
        method: wreq::Method,
        path: &str,
        params: Option<&Value>,
        account: Option<&str>,
        idempotency_key: Option<&str>,
        action: &str,
    ) -> Result<Value, ApiError> {
        let body = params.map(form_body).unwrap_or_default();
        let mut attempt = 0;
        loop {
            let mut request = CLIENT
                .request(method.clone(), format!("{API}{path}"))
                .bearer_auth(self.secret_key)
                .header("Stripe-Version", &TICKETING.stripe_api_version);
            if let Some(account) = account {
                request = request.header("Stripe-Account", account);
            }
            if let Some(key) = idempotency_key {
                request = request.header("Idempotency-Key", key);
            }
            if params.is_some() {
                request = request
                    .header("Content-Type", "application/x-www-form-urlencoded")
                    .body(body.clone());
            }
            let failure = match request.send().await {
                Ok(response) => {
                    let status = response.status();
                    let retry_hint = response
                        .headers()
                        .get("stripe-should-retry")
                        .and_then(|value| value.to_str().ok())
                        .map(|value| value == "true");
                    let request_id = response
                        .headers()
                        .get("request-id")
                        .and_then(|value| value.to_str().ok())
                        .unwrap_or_default()
                        .to_owned();
                    let payload: Value = response.json().await.unwrap_or(Value::Null);
                    if status.is_success() {
                        return Ok(payload);
                    }
                    let retryable = retry_hint.unwrap_or(
                        status == StatusCode::TOO_MANY_REQUESTS
                            || status == StatusCode::CONFLICT
                            || status.is_server_error(),
                    );
                    let message = payload["error"]["message"].as_str().unwrap_or("no message");
                    (
                        retryable,
                        format!("HTTP {status}: {message} (request {request_id})"),
                    )
                }
                Err(error) => (true, format!("{error}")),
            };
            let (retryable, detail) = failure;
            if retryable && attempt < TICKETING.stripe_network_retries {
                attempt += 1;
                tokio::time::sleep(Duration::from_millis(500 << attempt)).await;
                continue;
            }
            tracing::error!("Stripe {action} failed: {detail}");
            return Err(ApiError::http(
                StatusCode::SERVICE_UNAVAILABLE,
                PAYMENT_PROVIDER_UNAVAILABLE,
            ));
        }
    }
}

fn account_from(value: &Value) -> Result<ConnectedAccount, ApiError> {
    ConnectedAccount::from_json(value)
        .ok_or_else(|| ApiError::Internal(anyhow::anyhow!("Stripe returned an account with no id")))
}

fn string_field(value: &Value, name: &str) -> Result<String, ApiError> {
    value[name]
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| ApiError::Internal(anyhow::anyhow!("Stripe's reply has no {name}")))
}

/// Stripe's form encoding: nested objects and lists as `a[b][0][c]=value`.
fn form_body(params: &Value) -> String {
    let mut pairs = Vec::new();
    form_pairs("", params, &mut pairs);
    let mut body = form_urlencoded::Serializer::new(String::new());
    for (name, value) in pairs {
        body.append_pair(&name, &value);
    }
    body.finish()
}

fn form_pairs(prefix: &str, value: &Value, pairs: &mut Vec<(String, String)>) {
    let nested = |key: &str| {
        if prefix.is_empty() {
            key.to_owned()
        } else {
            format!("{prefix}[{key}]")
        }
    };
    match value {
        Value::Object(map) => {
            for (key, item) in map {
                form_pairs(&nested(key), item, pairs);
            }
        }
        Value::Array(items) => {
            for (index, item) in items.iter().enumerate() {
                form_pairs(&nested(&index.to_string()), item, pairs);
            }
        }
        Value::Null => {}
        Value::Bool(flag) => pairs.push((prefix.to_owned(), flag.to_string())),
        Value::Number(number) => pairs.push((prefix.to_owned(), number.to_string())),
        Value::String(text) => pairs.push((prefix.to_owned(), text.clone())),
    }
}

/// A Connect webhook event, only once its signature (`Stripe-Signature`:
/// `t=<unix time>,v1=<hex HMAC-SHA256 of "t.payload">`) proves it came from
/// Stripe, signed recently enough that it cannot be a replay.
pub fn verified_event(
    settings: &Settings,
    payload: &[u8],
    signature: Option<&str>,
    now_unix: i64,
) -> Result<WebhookEvent, ApiError> {
    if settings.stripe_webhook_secret.is_empty() {
        return Err(ApiError::validation(PAID_TICKETS_DISABLED));
    }
    let invalid = || ApiError::authentication(STRIPE_SIGNATURE_INVALID);
    let header = signature.ok_or_else(invalid)?;
    let mut timestamp = None;
    let mut signatures = Vec::new();
    for part in header.split(',') {
        match part.trim().split_once('=') {
            Some(("t", value)) => timestamp = value.parse::<i64>().ok(),
            Some(("v1", value)) => signatures.extend(hex::decode(value).ok()),
            _ => {}
        }
    }
    let timestamp = timestamp.ok_or_else(invalid)?;
    if (now_unix - timestamp).abs() > TICKETING.webhook_tolerance_seconds {
        return Err(invalid());
    }
    let mut mac = Hmac::<Sha256>::new_from_slice(settings.stripe_webhook_secret.as_bytes())
        .map_err(|error| ApiError::Internal(error.into()))?;
    mac.update(format!("{timestamp}.").as_bytes());
    mac.update(payload);
    if !signatures
        .iter()
        .any(|candidate| mac.clone().verify_slice(candidate).is_ok())
    {
        return Err(invalid());
    }
    let event: Value = serde_json::from_slice(payload).map_err(|_| invalid())?;
    Ok(WebhookEvent {
        kind: event["type"].as_str().unwrap_or_default().to_owned(),
        object: match &event["data"]["object"] {
            Value::Object(object) => Value::Object(object.clone()),
            _ => Value::Object(Map::new()),
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::test_settings;

    #[test]
    fn nested_params_use_stripe_form_encoding() {
        let body = form_body(&json!({
            "mode": "payment",
            "line_items": [{"quantity": 2, "price_data": {"currency": "cad", "unit_amount": 1500}}],
            "payment_method_types": ["card"],
            "metadata": {"order_id": "a b"},
            "skipped": null,
            "flag": true,
        }));
        assert_eq!(
            body,
            "mode=payment&line_items%5B0%5D%5Bquantity%5D=2\
             &line_items%5B0%5D%5Bprice_data%5D%5Bcurrency%5D=cad\
             &line_items%5B0%5D%5Bprice_data%5D%5Bunit_amount%5D=1500\
             &payment_method_types%5B0%5D=card&metadata%5Border_id%5D=a+b&flag=true"
        );
    }

    #[test]
    fn an_account_reads_its_flags_and_every_requirement_once() {
        let account = ConnectedAccount::from_json(&json!({
            "id": "acct_123",
            "charges_enabled": true,
            "payouts_enabled": false,
            "details_submitted": true,
            "requirements": {
                "currently_due": ["external_account", "individual.id_number"],
                "past_due": ["external_account"],
            },
        }))
        .unwrap();
        assert_eq!(account.id, "acct_123");
        assert!(account.charges_enabled && !account.payouts_enabled && account.details_submitted);
        assert_eq!(
            account.requirements_due,
            ["external_account", "individual.id_number"]
        );
        assert!(ConnectedAccount::from_json(&json!({})).is_none());
    }

    fn signed(secret: &str, timestamp: i64, payload: &str) -> String {
        let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).unwrap();
        mac.update(format!("{timestamp}.{payload}").as_bytes());
        format!(
            "t={timestamp},v1={},v0=ignored",
            hex::encode(mac.finalize().into_bytes())
        )
    }

    #[test]
    fn only_a_fresh_correctly_signed_event_is_accepted() {
        let settings = test_settings(&[("STRIPE_WEBHOOK_SECRET", "whsec_test")]);
        let payload = r#"{"type":"checkout.session.completed","data":{"object":{"id":"cs_1"}}}"#;
        let now = 1_800_000_000;

        let event = verified_event(
            &settings,
            payload.as_bytes(),
            Some(&signed("whsec_test", now, payload)),
            now,
        )
        .unwrap();
        assert_eq!(event.kind, "checkout.session.completed");
        assert_eq!(event.object["id"], "cs_1");

        let refused = |header: Option<String>, at: i64| {
            matches!(
                verified_event(&settings, payload.as_bytes(), header.as_deref(), at),
                Err(ApiError::Authentication(_))
            )
        };
        assert!(refused(Some(signed("whsec_other", now, payload)), now));
        assert!(refused(Some(signed("whsec_test", now, "{}")), now));
        assert!(refused(
            Some(signed("whsec_test", now, payload)),
            now + TICKETING.webhook_tolerance_seconds + 1
        ));
        assert!(refused(None, now));
        assert!(refused(Some("v1=00".into()), now));
    }

    #[test]
    fn without_a_webhook_secret_paid_tickets_are_off() {
        let settings = test_settings(&[]);
        assert!(matches!(
            verified_event(&settings, b"{}", Some("t=1,v1=00"), 1),
            Err(ApiError::Validation { .. })
        ));
        assert!(matches!(
            Stripe::new(&settings),
            Err(ApiError::Validation { .. })
        ));
    }
}
