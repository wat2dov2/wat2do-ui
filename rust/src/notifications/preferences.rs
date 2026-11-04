//! Whether users want a notification type (`services/notifications/preferences.py`).
//!
//! A user with no row for a type has never chosen, so the type's default in
//! `controlbox/notification_defaults.json` applies.

use std::collections::{HashMap, HashSet};

use anyhow::Result;
use sqlx::PgPool;
use uuid::Uuid;

use crate::controlbox::NOTIFICATION_DEFAULTS;

/// The users among `user_ids` who receive `notification_type`.
pub async fn enabled_user_ids(
    pool: &PgPool,
    user_ids: &[Uuid],
    notification_type: &str,
) -> Result<HashSet<Uuid>> {
    if user_ids.is_empty() {
        return Ok(HashSet::new());
    }
    let explicit: HashMap<Uuid, bool> = sqlx::query_as(
        "SELECT user_id, enabled FROM public.notification_preferences \
         WHERE notification_type = $1 AND user_id = ANY($2)",
    )
    .bind(notification_type)
    .bind(user_ids)
    .fetch_all(pool)
    .await?
    .into_iter()
    .collect();
    Ok(resolve(user_ids, &explicit, notification_type))
}

fn resolve(
    user_ids: &[Uuid],
    explicit: &HashMap<Uuid, bool>,
    notification_type: &str,
) -> HashSet<Uuid> {
    let default_enabled = NOTIFICATION_DEFAULTS.enabled(notification_type);
    user_ids
        .iter()
        .filter(|user_id| *explicit.get(user_id).unwrap_or(&default_enabled))
        .copied()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::NOTIFICATION_TYPE_MORNING_EMAIL;

    #[test]
    fn the_morning_email_reaches_everyone_who_has_not_turned_it_off() {
        let (on, off, silent) = (Uuid::from_u128(1), Uuid::from_u128(2), Uuid::from_u128(3));
        let explicit = HashMap::from([(on, true), (off, false)]);
        assert_eq!(
            resolve(
                &[on, off, silent],
                &explicit,
                NOTIFICATION_TYPE_MORNING_EMAIL
            ),
            HashSet::from([on, silent])
        );
        assert!(resolve(&[silent], &HashMap::new(), "retired_type").is_empty());
    }
}
