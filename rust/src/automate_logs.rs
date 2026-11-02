//! Rows in `public.automate_logs`, the admin Diagnostics log
//! (`services/automate_log_service.py` in Python, which the webhooks still use).

use serde_json::Value;
use sqlx::PgPool;

/// Insert one log row from its fields (`event`, `sender_id`, `school`, `ig_account`,
/// `post_url`, `payload`); whether it was stored. A failure is logged by its kind only.
pub async fn create_automate_log(pool: &PgPool, fields: &Value) -> bool {
    let text = |key: &str| fields.get(key).and_then(Value::as_str).map(str::to_owned);
    let inserted = sqlx::query(
        "INSERT INTO public.automate_logs (event, sender_id, school, ig_account, post_url, payload) \
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(text("event").unwrap_or_default())
    .bind(text("sender_id"))
    .bind(text("school"))
    .bind(text("ig_account"))
    .bind(text("post_url"))
    .bind(fields.get("payload").filter(|payload| !payload.is_null()))
    .execute(pool)
    .await;
    match inserted {
        Ok(_) => true,
        Err(error) => {
            let kind = match &error {
                sqlx::Error::Database(_) => "DatabaseError",
                sqlx::Error::PoolTimedOut | sqlx::Error::PoolClosed => "PoolError",
                _ => "ConnectionError",
            };
            tracing::warn!("Failed to insert automate log into database ({kind})");
            false
        }
    }
}
