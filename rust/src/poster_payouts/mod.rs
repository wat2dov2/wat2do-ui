//! Promoter poster payouts (`services/poster_payout_service.py`): earnings
//! derived from confirmed scans, frozen monthly payout rows, automatic fraud
//! holds and the Interac CSV. The `/qr` and `/payouts` routes and the
//! monthly job (`wat2do-poster-payouts`) share this module.
//!
//! Money is integer cents throughout: a payout's amount is always
//! `scan_count * rate_cents` (a database CHECK enforces it), and the rate is
//! frozen on the row when it is first written.

pub mod risk;
pub mod run;

use chrono::{DateTime, Datelike, NaiveDate, TimeZone, Utc};
use serde_json::Value;
use sqlx::postgres::PgRow;
use sqlx::{PgExecutor, Row};
use uuid::Uuid;

use crate::api::email_address;

/// A payout's status. `paid` and `voided` are final.
pub const PENDING: &str = "pending";
pub const HELD: &str = "held";
pub const PAID: &str = "paid";
pub const VOIDED: &str = "voided";
pub const PAYOUT_STATUSES: &[&str] = &[PENDING, HELD, PAID, VOIDED];
pub const FRAUD_STATUSES: &[&str] = &["flagged", "clear"];

/// `month_bounds`: the UTC month holding `value`, as `[start, end)`.
pub fn month_bounds(value: NaiveDate) -> (DateTime<Utc>, DateTime<Utc>) {
    let start = Utc
        .with_ymd_and_hms(value.year(), value.month(), 1, 0, 0, 0)
        .single()
        .expect("the first of a month is a valid UTC time");
    let (year, month) = if value.month() == 12 {
        (value.year() + 1, 1)
    } else {
        (value.year(), value.month() + 1)
    };
    let end = Utc
        .with_ymd_and_hms(year, month, 1, 0, 0, 0)
        .single()
        .expect("the first of a month is a valid UTC time");
    (start, end)
}

/// One `poster_payouts` row as Python validates it (`PosterPayoutResponse`):
/// the payout email is the normalized address pydantic's `EmailStr` returns.
#[derive(Debug, Clone, PartialEq)]
pub struct PosterPayout {
    pub id: Uuid,
    pub user_id: Uuid,
    pub period: NaiveDate,
    pub payout_email: String,
    pub rate_cents: i64,
    pub amount_cents: i64,
    pub scan_count: i64,
    pub status: String,
    pub paid_at: Option<DateTime<Utc>>,
    pub notes: Option<String>,
    pub reviewed_by: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// `PayoutEmail`: an `EmailStr` that cannot start a spreadsheet formula.
/// `Err` is pydantic's reason, which Python raises as a validation error.
pub fn payout_email(value: &str) -> Result<String, String> {
    let normalized = email_address::normalize(value)
        .map_err(|reason| format!("value is not a valid email address: {reason}"))?;
    if normalized.starts_with(['=', '+', '-', '@', '\t', '\r', '\n']) {
        return Err("payout email cannot begin with a spreadsheet formula character".into());
    }
    Ok(normalized)
}

impl PosterPayout {
    pub fn from_row(row: &PgRow) -> anyhow::Result<Self> {
        let stored: String = row.try_get("payout_email")?;
        let payout_email = payout_email(&stored).map_err(|reason| {
            anyhow::anyhow!("poster_payouts row has an invalid payout_email: {reason}")
        })?;
        Ok(Self {
            id: row.try_get("id")?,
            user_id: row.try_get("user_id")?,
            period: row.try_get("period")?,
            payout_email,
            rate_cents: i64::from(row.try_get::<i32, _>("rate_cents")?),
            amount_cents: i64::from(row.try_get::<i32, _>("amount_cents")?),
            scan_count: i64::from(row.try_get::<i32, _>("scan_count")?),
            status: row.try_get("status")?,
            paid_at: row.try_get("paid_at")?,
            notes: row.try_get("notes")?,
            reviewed_by: row.try_get("reviewed_by")?,
            created_at: row.try_get("created_at")?,
            updated_at: row.try_get("updated_at")?,
        })
    }

    /// `derive_fraud_status`: held and voided payouts are flagged.
    pub fn fraud_status(&self) -> &'static str {
        if self.status == HELD || self.status == VOIDED {
            "flagged"
        } else {
            "clear"
        }
    }
}

/// One promoter poster's scans in a period (`get_promoter_earnings`).
#[derive(Debug, Clone, PartialEq)]
pub struct EarningsRow {
    pub qr_code_id: String,
    pub name: String,
    pub is_active: bool,
    pub latest_scan: Option<DateTime<Utc>>,
    pub latitude: f64,
    pub longitude: f64,
    pub poster_template_id: Option<String>,
    pub image_url: Option<String>,
    pub lifetime_unique_scans: i64,
    pub period_unique_scans: i64,
    /// Unique confirmed visitors first seen this period, less the poster's
    /// own first visitor (the person who put it up).
    pub period_creditable_scans: i64,
}

/// `_get_earnings_rows`: every promoter poster of `user_id`, newest first.
pub async fn earnings_rows<'e>(
    executor: impl PgExecutor<'e>,
    user_id: Uuid,
    period_start: DateTime<Utc>,
    period_end: DateTime<Utc>,
) -> Result<Vec<EarningsRow>, sqlx::Error> {
    let rows = sqlx::query(
        "SELECT qr_code_id, name, is_active, latest_scan, latitude, longitude, \
                poster_template_id, image_url, lifetime_unique_scans, period_unique_scans, \
                period_creditable_scans \
         FROM public.get_promoter_earnings($1, $2, $3)",
    )
    .bind(user_id)
    .bind(period_start)
    .bind(period_end)
    .fetch_all(executor)
    .await?;
    rows.iter()
        .map(|row| {
            let coordinate = |name: &str| -> Result<f64, sqlx::Error> {
                row.try_get::<Option<f64>, _>(name)?.ok_or_else(|| {
                    sqlx::Error::Decode(format!("promoter poster has no {name}").into())
                })
            };
            Ok(EarningsRow {
                qr_code_id: row.try_get("qr_code_id")?,
                name: row.try_get("name")?,
                is_active: row.try_get("is_active")?,
                latest_scan: row.try_get("latest_scan")?,
                latitude: coordinate("latitude")?,
                longitude: coordinate("longitude")?,
                poster_template_id: row.try_get("poster_template_id")?,
                image_url: row.try_get("image_url")?,
                lifetime_unique_scans: row.try_get("lifetime_unique_scans")?,
                period_unique_scans: row.try_get("period_unique_scans")?,
                period_creditable_scans: row.try_get("period_creditable_scans")?,
            })
        })
        .collect()
}

/// A scan of a promoter's posters in a period, with its stored risk flags.
#[derive(Debug, Clone, PartialEq)]
pub struct StoredScan {
    pub scan: risk::PeriodScan,
    pub risk_flags: Value,
}

/// `_load_period_scans`: every scan of the promoter's posters in
/// `[period_start, period_end)`, oldest first.
pub async fn load_period_scans<'e>(
    executor: impl PgExecutor<'e>,
    user_id: Uuid,
    period_start: DateTime<Utc>,
    period_end: DateTime<Utc>,
) -> Result<Vec<StoredScan>, sqlx::Error> {
    let rows = sqlx::query(
        "SELECT scan.id::text AS id, scan.dedupe_hash, scan.ip_hash, scan.scanned_at, \
                scan.risk_flags \
         FROM public.qr_code_scans AS scan \
         JOIN public.qr_codes AS qr_code ON qr_code.id = scan.qr_code_id \
         WHERE qr_code.created_by = $1 AND qr_code.program = 'promoter' \
           AND scan.scanned_at >= $2 AND scan.scanned_at < $3 \
         ORDER BY scan.scanned_at, scan.id",
    )
    .bind(user_id)
    .bind(period_start)
    .bind(period_end)
    .fetch_all(executor)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(StoredScan {
                scan: risk::PeriodScan {
                    id: row.try_get("id")?,
                    dedupe_hash: row.try_get("dedupe_hash")?,
                    ip_hash: row.try_get("ip_hash")?,
                    scanned_at: row.try_get("scanned_at")?,
                },
                risk_flags: row.try_get::<sqlx::types::Json<Value>, _>("risk_flags")?.0,
            })
        })
        .collect()
}

/// `f"{cents // 100}.{cents % 100:02d}"` (floor division, as Python's).
pub fn format_amount(cents: i64) -> String {
    format!("{}.{:02}", cents.div_euclid(100), cents.rem_euclid(100))
}

/// One CSV field as Python's `csv` module writes it (`QUOTE_MINIMAL`).
fn csv_field(value: &str) -> String {
    if value.contains([',', '"', '\r', '\n']) {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_owned()
    }
}

/// `serialize_interac_csv`: the reviewed pending payouts for an Interac
/// bulk transfer, one row each, with `\r\n` line endings.
pub fn serialize_interac_csv(payouts: &[PosterPayout]) -> String {
    let mut csv = String::from("recipient_email,amount,scan_count,status,reference,notes\r\n");
    for payout in payouts {
        let fields = [
            csv_field(&payout.payout_email),
            format_amount(payout.amount_cents),
            payout.scan_count.to_string(),
            csv_field(&payout.status),
            payout.id.to_string(),
            format!("Wat2Do poster payout {}", payout.period.format("%Y-%m")),
        ];
        csv.push_str(&fields.join(","));
        csv.push_str("\r\n");
    }
    csv
}

#[cfg(test)]
mod tests {
    use super::*;

    fn payout() -> PosterPayout {
        PosterPayout {
            id: Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa").unwrap(),
            user_id: Uuid::from_u128(1),
            period: NaiveDate::from_ymd_opt(2026, 6, 1).unwrap(),
            payout_email: "promoter@example.com".into(),
            rate_cents: 25,
            amount_cents: 250,
            scan_count: 10,
            status: PENDING.into(),
            paid_at: None,
            notes: None,
            reviewed_by: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }

    #[test]
    fn month_bounds_are_utc_and_cross_year() {
        let (start, end) = month_bounds(NaiveDate::from_ymd_opt(2026, 12, 15).unwrap());
        assert_eq!(start, Utc.with_ymd_and_hms(2026, 12, 1, 0, 0, 0).unwrap());
        assert_eq!(end, Utc.with_ymd_and_hms(2027, 1, 1, 0, 0, 0).unwrap());
        let (start, end) = month_bounds(NaiveDate::from_ymd_opt(2028, 2, 29).unwrap());
        assert_eq!(start, Utc.with_ymd_and_hms(2028, 2, 1, 0, 0, 0).unwrap());
        assert_eq!(end, Utc.with_ymd_and_hms(2028, 3, 1, 0, 0, 0).unwrap());
    }

    #[test]
    fn amounts_are_whole_cents() {
        for (cents, text) in [
            (0, "0.00"),
            (5, "0.05"),
            (100, "1.00"),
            (250, "2.50"),
            (101, "1.01"),
            (i64::from(i32::MAX), "21474836.47"),
        ] {
            assert_eq!(format_amount(cents), text);
        }
    }

    #[test]
    fn interac_csv_matches_python_csv() {
        // backend/tests/services/test_poster_payout_service.py::test_interac_csv_uses_frozen_payout_email_and_reference
        let csv = serialize_interac_csv(&[payout()]);
        assert_eq!(
            csv,
            "recipient_email,amount,scan_count,status,reference,notes\r\n\
             promoter@example.com,2.50,10,pending,aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa,Wat2Do poster payout 2026-06\r\n"
        );
        assert_eq!(
            serialize_interac_csv(&[]),
            "recipient_email,amount,scan_count,status,reference,notes\r\n"
        );
        // csv.writer quotes a field holding a comma or quote, doubling quotes.
        assert_eq!(csv_field("a,b"), "\"a,b\"");
        assert_eq!(csv_field("a\"b"), "\"a\"\"b\"");
        assert_eq!(csv_field("plain@example.com"), "plain@example.com");
    }

    #[test]
    fn payout_emails_are_normalized_and_refuse_formulas() {
        assert_eq!(
            payout_email("Promoter@Example.COM").unwrap(),
            "Promoter@example.com"
        );
        assert!(payout_email("=cmd@example.com").is_err());
        assert!(payout_email("+1@example.com").is_err());
        assert!(payout_email("-x@example.com").is_err());
        assert!(payout_email("not-an-email").is_err());
    }

    #[test]
    fn held_and_voided_payouts_are_flagged() {
        for (status, fraud) in [
            (PENDING, "clear"),
            (PAID, "clear"),
            (HELD, "flagged"),
            (VOIDED, "flagged"),
        ] {
            let payout = PosterPayout {
                status: status.into(),
                ..payout()
            };
            assert_eq!(payout.fraud_status(), fraud);
        }
    }
}
