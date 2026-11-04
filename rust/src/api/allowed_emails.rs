//! `core/allowed_emails.py`: which school a student email belongs to.
//!
//! The domain to school mapping comes from `school_email_domains` (joined to
//! `schools`) and is read once per process, on the first lookup.

use std::collections::HashMap;

use tokio::sync::OnceCell;
use unicode_normalization::UnicodeNormalization;

/// The process's domain to school slug table.
#[derive(Default)]
pub struct AllowedEmailDomains {
    domains: OnceCell<HashMap<String, String>>,
}

impl AllowedEmailDomains {
    /// A table that is already loaded (tests).
    pub fn from_domains(domains: HashMap<String, String>) -> Self {
        Self {
            domains: OnceCell::from(domains),
        }
    }

    async fn load(db: &sqlx::PgPool) -> Result<HashMap<String, String>, sqlx::Error> {
        let rows: Vec<(String, String)> = sqlx::query_as(
            "SELECT school_email_domains.domain, schools.slug \
             FROM public.school_email_domains \
             JOIN public.schools ON schools.id = school_email_domains.school_id",
        )
        .fetch_all(db)
        .await?;
        let mut domains = HashMap::new();
        for (domain, slug) in rows {
            if domain.is_empty() || slug.is_empty() {
                continue;
            }
            if let Some(canonical) = normalize_domain(&domain) {
                domains
                    .entry(canonical)
                    .or_insert_with(|| slug.trim().to_lowercase());
            }
        }
        Ok(domains)
    }

    /// `get_school_for_email`: the school slug for an allowed email, else `None`.
    pub async fn school_for_email(&self, db: &sqlx::PgPool, email: &str) -> Option<String> {
        let canonical = email_domain(email)?;
        // A failed load is retried on the next lookup rather than remembered
        // as an empty table (the Python module kept it until restart).
        let domains = self
            .domains
            .get_or_try_init(|| Self::load(db))
            .await
            .inspect_err(|error| {
                tracing::error!("Failed to load school email domains from the database: {error}")
            })
            .ok()?;
        domains.get(&canonical).cloned()
    }
}

/// The canonical domain of a well-formed email, or `None` for anything a
/// header-injection or multi-`@` payload could hide in.
pub fn email_domain(email: &str) -> Option<String> {
    let email = email.trim();
    if email.is_empty()
        || email
            .chars()
            .any(|character| character < '\u{20}' || character == '\u{7f}')
    {
        return None;
    }
    let email = email.to_lowercase();
    if email.matches('@').count() != 1 {
        return None;
    }
    let (local, domain) = email.rsplit_once('@')?;
    if local.is_empty() || domain.is_empty() {
        return None;
    }
    normalize_domain(domain)
}

/// `_normalize_domain`: NFKC, then IDNA, so homographs of an allowed domain
/// become punycode that is never on the list.
pub fn normalize_domain(domain: &str) -> Option<String> {
    let normalized: String = domain.nfkc().collect();
    match idna::domain_to_ascii(&normalized) {
        Ok(ascii) => Some(ascii.to_lowercase()),
        Err(error) => {
            tracing::warn!("Failed to normalise email domain {domain:?}: {error}");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn table() -> AllowedEmailDomains {
        AllowedEmailDomains::from_domains(
            [
                ("uwaterloo.ca", "uwaterloo"),
                ("edu.uwaterloo.ca", "uwaterloo"),
                ("wlu.ca", "wlu"),
                ("utoronto.ca", "utsg"),
                ("scar.utoronto.ca", "utsc"),
                ("cornell.edu", "cornell"),
            ]
            .into_iter()
            .map(|(domain, slug)| (domain.to_owned(), slug.to_owned()))
            .collect(),
        )
    }

    async fn school(email: &str) -> Option<String> {
        let db = crate::db::connect_lazy(
            "postgres://localhost:1/none".parse().unwrap(),
            1,
            std::time::Duration::from_secs(1),
            std::time::Duration::from_secs(1),
            false,
        );
        table().school_for_email(&db, email).await
    }

    #[tokio::test]
    async fn lookups_match_core_allowed_emails() {
        // backend/tests/core/test_allowed_emails.py
        assert_eq!(
            school("alice@uwaterloo.ca").await.as_deref(),
            Some("uwaterloo")
        );
        assert_eq!(
            school("ALICE@UWATERLOO.CA").await.as_deref(),
            Some("uwaterloo")
        );
        assert_eq!(school("  bob@wlu.ca  ").await.as_deref(), Some("wlu"));
        assert_eq!(school("x@scar.utoronto.ca").await.as_deref(), Some("utsc"));
        assert_eq!(school("evil@gmail.com").await, None);
        assert_eq!(school("").await, None);
        assert_eq!(school("a@b@uwaterloo.ca").await, None);
        assert_eq!(school("a@b@c@uwaterloo.ca").await, None);
        assert_eq!(school("alice.uwaterloo.ca").await, None);
        assert_eq!(school("@uwaterloo.ca").await, None);
        assert_eq!(school("alice@").await, None);
        assert_eq!(school("alice@uwaterloo.ca\r\nBcc: x@y.z").await, None);
        assert_eq!(school("alice\u{0}@uwaterloo.ca").await, None);
    }

    #[tokio::test]
    async fn homographs_and_compatibility_forms_are_canonicalised() {
        // Cyrillic "о" becomes punycode, never an allowed domain.
        assert_eq!(school("alice@uwaterl\u{043e}o.ca").await, None);
        assert_eq!(
            normalize_domain("uwaterl\u{043e}.ca").as_deref(),
            Some("xn--uwaterl-gjg.ca")
        );
        // Fullwidth letters and the ideographic full stop fold to ASCII, as in Python.
        assert_eq!(
            school(
                "alice@\u{ff55}\u{ff57}\u{ff41}\u{ff54}\u{ff45}\u{ff52}\u{ff4c}\u{ff4f}\u{ff4f}.ca"
            )
            .await
            .as_deref(),
            Some("uwaterloo")
        );
        assert_eq!(
            school("alice@uwaterloo\u{3002}ca").await.as_deref(),
            Some("uwaterloo")
        );
    }
}
