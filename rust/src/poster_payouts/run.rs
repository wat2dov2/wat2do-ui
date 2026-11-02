//! `run_period_payouts`: freeze one closed UTC month's promoter payouts and
//! export the pending ones for Interac (`wat2do-poster-payouts`).
//!
//! The database rows are the source of truth; the CSV is a convenience copy.
//! Each promoter is written in one transaction (their payout row and their
//! scans' risk), so a crash leaves every promoter either done or untouched,
//! and a rerun is idempotent: a payout whose computed values match the row
//! is not written again, and paid or voided payouts are never changed.
//! A run holds a database advisory lock, so two runs never interleave.

use std::collections::HashMap;
use std::path::Path;

use anyhow::{Context, Result, bail, ensure};
use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;
use serde_json::{Value, json};
use sqlx::{PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

use super::risk::{RiskEvaluation, evaluate_period_scans};
use super::{
    HELD, PAID, PENDING, PosterPayout, StoredScan, VOIDED, earnings_rows, load_period_scans,
    month_bounds, payout_email, serialize_interac_csv,
};
use crate::controlbox::PromoterProgram;

/// `pg_advisory_lock` key held for a whole run ("poster-payouts").
const RUN_LOCK_KEY: i64 = 0x706f_7374_6572_7061;
/// Scans updated per statement (`batched(scan_ids, 500)`).
const RISK_UPDATE_BATCH: usize = 500;

/// What a run writes for one promoter's payout.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PayoutWrite {
    pub payout_email: String,
    pub rate_cents: i64,
    pub scan_count: i64,
    pub amount_cents: i64,
    pub status: String,
    pub notes: Option<String>,
    pub reviewed_by: Option<Uuid>,
}

/// `_upsert_period_payout`'s decision.
#[derive(Debug, Clone, PartialEq)]
pub enum PayoutDecision {
    /// Leave the row as it is: it is final, or already holds these values.
    Keep,
    Insert(PayoutWrite),
    /// Update the row, provided its status is still the one read.
    Update(PayoutWrite),
}

fn risk_notes(evaluation: &RiskEvaluation, control: &PromoterProgram) -> String {
    let codes: Vec<&str> = evaluation
        .findings
        .iter()
        .map(|finding| finding.code.as_str())
        .collect();
    format!(
        "Automatic fraud hold using {}: {}",
        control.risk_rules_version,
        codes.join(", ")
    )
}

/// Decide a promoter's payout for the period. A final payout (paid or
/// voided) is kept. A payout at or over the risk threshold is held with the
/// rule codes as notes, except that a hold an administrator placed keeps
/// its notes and reviewer; a held payout stays held until an administrator
/// releases it. An existing row keeps its frozen email and rate.
pub fn decide_payout(
    existing: Option<&PosterPayout>,
    user_payout_email: &str,
    scan_count: i64,
    evaluation: &RiskEvaluation,
    control: &PromoterProgram,
) -> PayoutDecision {
    if let Some(existing) = existing
        && (existing.status == PAID || existing.status == VOIDED)
    {
        return PayoutDecision::Keep;
    }
    let was_held = existing.is_some_and(|existing| existing.status == HELD);
    let should_hold = evaluation.score >= control.hold_score_threshold;
    let status = if should_hold || was_held {
        HELD
    } else {
        PENDING
    };
    let mut notes = existing.and_then(|existing| existing.notes.clone());
    let mut reviewed_by = existing.and_then(|existing| existing.reviewed_by);
    let manually_held = was_held && reviewed_by.is_some();
    if should_hold && !manually_held {
        notes = Some(risk_notes(evaluation, control));
        if !was_held {
            reviewed_by = None;
        }
    }
    let rate_cents = existing.map_or(control.rate_cents, |existing| existing.rate_cents);
    let payout_email = existing.map_or_else(
        || user_payout_email.to_owned(),
        |existing| existing.payout_email.clone(),
    );
    let write = PayoutWrite {
        payout_email,
        rate_cents,
        scan_count,
        amount_cents: scan_count * rate_cents,
        status: status.to_owned(),
        notes,
        reviewed_by,
    };
    match existing {
        None => PayoutDecision::Insert(write),
        Some(existing)
            if existing.payout_email == write.payout_email
                && existing.rate_cents == write.rate_cents
                && existing.scan_count == write.scan_count
                && existing.amount_cents == write.amount_cents
                && existing.status == write.status
                && existing.paid_at.is_none()
                && existing.notes == write.notes
                && existing.reviewed_by == write.reviewed_by =>
        {
            PayoutDecision::Keep
        }
        Some(_) => PayoutDecision::Update(write),
    }
}

/// The risk columns written to one group of scans.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ScanRisk {
    pub risk_score: i64,
    pub risk_flags: Vec<Value>,
}

/// `_store_scan_risk`'s groups: scans with identical risk, in the order
/// each group first appears, each group's ids in scan order.
pub fn scan_risk_groups(
    scans: &[StoredScan],
    evaluation: &RiskEvaluation,
) -> Vec<(ScanRisk, Vec<String>)> {
    let flags = evaluation.flags_by_scan_id();
    let mut groups: Vec<(ScanRisk, Vec<String>)> = Vec::new();
    for stored in scans {
        let scan_flags = flags
            .get(stored.scan.id.as_str())
            .cloned()
            .unwrap_or_default();
        let risk = ScanRisk {
            risk_score: scan_flags
                .iter()
                .map(|flag| flag["points"].as_i64().unwrap_or_default())
                .sum(),
            risk_flags: scan_flags,
        };
        match groups.iter_mut().find(|(group, _)| *group == risk) {
            Some((_, ids)) => ids.push(stored.scan.id.clone()),
            None => groups.push((risk, vec![stored.scan.id.clone()])),
        }
    }
    groups
}

/// One promoter's outcome, as a plan run reports it.
#[derive(Debug, Clone, Serialize)]
pub struct PlannedPayout {
    pub user_id: Uuid,
    /// "insert", "update", "unchanged" or "final" (paid or voided, untouched).
    pub action: &'static str,
    pub previous_status: Option<String>,
    pub payout: Option<PayoutWrite>,
    pub risk_score: i64,
    pub finding_codes: Vec<String>,
    /// Scan id to the risk score and flags the run stores on it.
    pub scan_risk: Vec<(String, ScanRisk)>,
}

/// The run's totals, printed as Python's `json.dumps(result, sort_keys=True)`.
#[derive(Debug, Clone, PartialEq)]
pub struct RunSummary {
    pub period: String,
    pub payouts_written: i64,
    pub held: i64,
    pub exported: i64,
    pub amount_cents: i64,
    pub csv: String,
}

impl RunSummary {
    pub fn to_json(&self) -> String {
        crate::api::json::python_dumps(&json!({
            "amount_cents": self.amount_cents,
            "csv": self.csv,
            "exported": self.exported,
            "held": self.held,
            "payouts_written": self.payouts_written,
            "period": self.period,
        }))
    }
}

/// Whether a run writes, or only reports what it would write.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Live,
    /// Read-only: compute every payout and scan risk and write nothing.
    Plan,
}

/// The promoters with at least one promoter poster, by user id.
async fn promoter_owner_ids(pool: &PgPool) -> Result<Vec<Uuid>> {
    Ok(sqlx::query_scalar(
        "SELECT DISTINCT created_by FROM public.qr_codes \
         WHERE program = 'promoter' ORDER BY created_by",
    )
    .fetch_all(pool)
    .await?)
}

/// Each owner's validated payout email; owners without a `users` row are
/// left out. An invalid stored email fails the run, as Python's
/// `UserResponse` validation does.
async fn payout_emails(pool: &PgPool, owners: &[Uuid]) -> Result<HashMap<Uuid, Option<String>>> {
    let rows = sqlx::query("SELECT id, payout_email FROM public.users WHERE id = ANY($1)")
        .bind(owners)
        .fetch_all(pool)
        .await?;
    rows.iter()
        .map(|row| {
            let id: Uuid = row.try_get("id")?;
            let stored: Option<String> = row.try_get("payout_email")?;
            let email = stored
                .map(|stored| payout_email(&stored))
                .transpose()
                .map_err(|reason| {
                    anyhow::anyhow!("user {id} has an invalid payout_email: {reason}")
                })?;
            Ok((id, email))
        })
        .collect()
}

async fn existing_payout(
    executor: impl sqlx::PgExecutor<'_>,
    user_id: Uuid,
    period: NaiveDate,
    lock: bool,
) -> Result<Option<PosterPayout>> {
    let sql = format!(
        "SELECT * FROM public.poster_payouts WHERE user_id = $1 AND period = $2{}",
        if lock { " FOR UPDATE" } else { "" }
    );
    let row = sqlx::query(&sql)
        .bind(user_id)
        .bind(period)
        .fetch_optional(executor)
        .await?;
    row.as_ref().map(PosterPayout::from_row).transpose()
}

fn cents(value: i64, name: &str) -> Result<i32> {
    i32::try_from(value).with_context(|| format!("{name} {value} does not fit the payout row"))
}

async fn write_payout(
    transaction: &mut Transaction<'_, Postgres>,
    user_id: Uuid,
    period: NaiveDate,
    existing: Option<&PosterPayout>,
    write: &PayoutWrite,
) -> Result<PosterPayout> {
    let row = match existing {
        None => {
            sqlx::query(
                "INSERT INTO public.poster_payouts \
                 (user_id, period, payout_email, rate_cents, scan_count, amount_cents, \
                  status, paid_at, notes, reviewed_by) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, $8, $9) RETURNING *",
            )
            .bind(user_id)
            .bind(period)
            .bind(&write.payout_email)
            .bind(cents(write.rate_cents, "rate_cents")?)
            .bind(cents(write.scan_count, "scan_count")?)
            .bind(cents(write.amount_cents, "amount_cents")?)
            .bind(&write.status)
            .bind(&write.notes)
            .bind(write.reviewed_by)
            .fetch_optional(&mut **transaction)
            .await?
        }
        Some(existing) => {
            sqlx::query(
                "UPDATE public.poster_payouts SET payout_email = $3, rate_cents = $4, \
                 scan_count = $5, amount_cents = $6, status = $7, paid_at = NULL, \
                 notes = $8, reviewed_by = $9 \
                 WHERE id = $1 AND status = $2 RETURNING *",
            )
            .bind(existing.id)
            .bind(&existing.status)
            .bind(&write.payout_email)
            .bind(cents(write.rate_cents, "rate_cents")?)
            .bind(cents(write.scan_count, "scan_count")?)
            .bind(cents(write.amount_cents, "amount_cents")?)
            .bind(&write.status)
            .bind(&write.notes)
            .bind(write.reviewed_by)
            .fetch_optional(&mut **transaction)
            .await?
        }
    };
    let Some(row) = row else {
        bail!("Payout changed during computation");
    };
    PosterPayout::from_row(&row)
}

async fn store_scan_risk(
    transaction: &mut Transaction<'_, Postgres>,
    groups: &[(ScanRisk, Vec<String>)],
    evaluated_at: DateTime<Utc>,
    rules_version: &str,
) -> Result<()> {
    for (risk, ids) in groups {
        for chunk in ids.chunks(RISK_UPDATE_BATCH) {
            let ids: Vec<Uuid> = chunk
                .iter()
                .map(|id| Uuid::parse_str(id))
                .collect::<Result<_, _>>()?;
            sqlx::query(
                "UPDATE public.qr_code_scans SET risk_score = $2, risk_flags = $3, \
                 risk_evaluated_at = $4, risk_rules_version = $5 WHERE id = ANY($1)",
            )
            .bind(&ids)
            .bind(cents(risk.risk_score, "risk_score")?)
            .bind(sqlx::types::Json(&risk.risk_flags))
            .bind(evaluated_at)
            .bind(rules_version)
            .execute(&mut **transaction)
            .await?;
        }
    }
    Ok(())
}

/// The payout a write would produce, for a plan run.
fn planned(
    existing: Option<&PosterPayout>,
    user_id: Uuid,
    period: NaiveDate,
    write: &PayoutWrite,
    now: DateTime<Utc>,
) -> PosterPayout {
    PosterPayout {
        id: existing.map_or_else(Uuid::nil, |existing| existing.id),
        user_id,
        period,
        payout_email: write.payout_email.clone(),
        rate_cents: write.rate_cents,
        amount_cents: write.amount_cents,
        scan_count: write.scan_count,
        status: write.status.clone(),
        paid_at: None,
        notes: write.notes.clone(),
        reviewed_by: write.reviewed_by,
        created_at: existing.map_or(now, |existing| existing.created_at),
        updated_at: now,
    }
}

/// Everything a run did or would do.
pub struct RunOutcome {
    pub summary: RunSummary,
    pub exported: Vec<PosterPayout>,
    pub plan: Vec<PlannedPayout>,
}

/// Compute (and, in `Mode::Live`, write) one closed period's payouts.
/// `period` is any day of the month; `now` must be at or after its end.
pub async fn run_period(
    pool: &PgPool,
    period: NaiveDate,
    now: DateTime<Utc>,
    output: &Path,
    mode: Mode,
    control: &PromoterProgram,
) -> Result<RunOutcome> {
    let (period_start, period_end) = month_bounds(period);
    ensure!(now >= period_end, "Payout period has not closed");
    let period_date = period_start.date_naive();

    // A session-level lock on one dedicated connection, held for the run.
    let mut lock = pool.acquire().await?;
    if mode == Mode::Live {
        let locked: bool = sqlx::query_scalar("SELECT pg_try_advisory_lock($1)")
            .bind(RUN_LOCK_KEY)
            .fetch_one(&mut *lock)
            .await?;
        ensure!(locked, "Another poster payout run is in progress");
    }
    let result = run_locked(
        pool,
        period_date,
        period_start,
        period_end,
        output,
        mode,
        control,
    )
    .await;
    if mode == Mode::Live {
        sqlx::query("SELECT pg_advisory_unlock($1)")
            .bind(RUN_LOCK_KEY)
            .execute(&mut *lock)
            .await?;
    }
    result
}

async fn run_locked(
    pool: &PgPool,
    period: NaiveDate,
    period_start: DateTime<Utc>,
    period_end: DateTime<Utc>,
    output: &Path,
    mode: Mode,
    control: &PromoterProgram,
) -> Result<RunOutcome> {
    let owners = promoter_owner_ids(pool).await?;
    let emails = payout_emails(pool, &owners).await?;
    let mut exported: Vec<PosterPayout> = Vec::new();
    let mut plan = Vec::new();
    let mut written = 0;
    let mut held = 0;

    for owner in owners {
        let Some(Some(user_email)) = emails.get(&owner) else {
            continue;
        };
        let rows = earnings_rows(pool, owner, period_start, period_end).await?;
        let scan_count: i64 = rows.iter().map(|row| row.period_creditable_scans).sum();
        if scan_count == 0 {
            continue;
        }
        let scans = load_period_scans(pool, owner, period_start, period_end).await?;
        let period_scans: Vec<_> = scans.iter().map(|stored| stored.scan.clone()).collect();
        let evaluation = evaluate_period_scans(&period_scans, control);
        let groups = scan_risk_groups(&scans, &evaluation);
        let evaluated_at = Utc::now();

        let (payout, action, previous_status) = match mode {
            Mode::Plan => {
                let existing = existing_payout(pool, owner, period, false).await?;
                let decision = decide_payout(
                    existing.as_ref(),
                    user_email,
                    scan_count,
                    &evaluation,
                    control,
                );
                let previous = existing.as_ref().map(|existing| existing.status.clone());
                match (&decision, &existing) {
                    (PayoutDecision::Keep, Some(existing)) => {
                        let action = if existing.status == PAID || existing.status == VOIDED {
                            "final"
                        } else {
                            "unchanged"
                        };
                        (existing.clone(), action, previous)
                    }
                    (PayoutDecision::Insert(write), _) => (
                        planned(None, owner, period, write, evaluated_at),
                        "insert",
                        previous,
                    ),
                    (PayoutDecision::Update(write), Some(existing)) => (
                        planned(Some(existing), owner, period, write, evaluated_at),
                        "update",
                        previous,
                    ),
                    _ => bail!("a payout decision needs an existing row"),
                }
            }
            Mode::Live => {
                let mut transaction = pool.begin().await?;
                let existing = existing_payout(&mut *transaction, owner, period, true).await?;
                let decision = decide_payout(
                    existing.as_ref(),
                    user_email,
                    scan_count,
                    &evaluation,
                    control,
                );
                let previous = existing.as_ref().map(|existing| existing.status.clone());
                let (payout, action) = match (&decision, &existing) {
                    (PayoutDecision::Keep, Some(existing)) => {
                        let action = if existing.status == PAID || existing.status == VOIDED {
                            "final"
                        } else {
                            "unchanged"
                        };
                        (existing.clone(), action)
                    }
                    (PayoutDecision::Insert(write), None) => (
                        write_payout(&mut transaction, owner, period, None, write).await?,
                        "insert",
                    ),
                    (PayoutDecision::Update(write), Some(existing)) => (
                        write_payout(&mut transaction, owner, period, Some(existing), write)
                            .await?,
                        "update",
                    ),
                    _ => bail!("a payout decision does not match the row"),
                };
                if action != "final" {
                    store_scan_risk(
                        &mut transaction,
                        &groups,
                        evaluated_at,
                        &control.risk_rules_version,
                    )
                    .await?;
                }
                transaction.commit().await?;
                (payout, action, previous)
            }
        };

        let final_payout = action == "final";
        plan.push(PlannedPayout {
            user_id: owner,
            action,
            previous_status,
            payout: (!final_payout).then(|| PayoutWrite {
                payout_email: payout.payout_email.clone(),
                rate_cents: payout.rate_cents,
                scan_count: payout.scan_count,
                amount_cents: payout.amount_cents,
                status: payout.status.clone(),
                notes: payout.notes.clone(),
                reviewed_by: payout.reviewed_by,
            }),
            risk_score: evaluation.score,
            finding_codes: evaluation
                .findings
                .iter()
                .map(|finding| finding.code.clone())
                .collect(),
            scan_risk: if final_payout {
                Vec::new()
            } else {
                groups
                    .iter()
                    .flat_map(|(risk, ids)| ids.iter().map(|id| (id.clone(), risk.clone())))
                    .collect()
            },
        });
        if final_payout {
            continue;
        }
        written += 1;
        if payout.status == HELD {
            held += 1;
        } else if payout.status == PENDING {
            exported.push(payout);
        }
    }

    if mode == Mode::Live {
        write_interac_csv(&exported, output)?;
    }
    Ok(RunOutcome {
        summary: RunSummary {
            period: period_start.format("%Y-%m").to_string(),
            payouts_written: written,
            held,
            exported: exported.len() as i64,
            amount_cents: exported.iter().map(|payout| payout.amount_cents).sum(),
            csv: output.display().to_string(),
        },
        exported,
        plan,
    })
}

/// `_write_interac_csv`: owner-only (0600) from the moment it exists.
pub fn write_interac_csv(payouts: &[PosterPayout], output: &Path) -> Result<()> {
    use std::io::Write;
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
    if let Some(parent) = output
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        std::fs::create_dir_all(parent)?;
    }
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(output)
        .with_context(|| format!("could not write {}", output.display()))?;
    file.write_all(serialize_interac_csv(payouts).as_bytes())?;
    std::fs::set_permissions(output, std::fs::Permissions::from_mode(0o600))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::controlbox::PROMOTER_PROGRAM;
    use crate::poster_payouts::risk::{PeriodScan, RiskFinding};

    const USER: Uuid = Uuid::from_u128(0x1111_1111_1111_1111_1111_1111_1111_1111);

    fn payout(status: &str) -> PosterPayout {
        PosterPayout {
            id: Uuid::from_u128(0xaaaa),
            user_id: USER,
            period: NaiveDate::from_ymd_opt(2026, 6, 1).unwrap(),
            payout_email: "promoter@example.com".into(),
            rate_cents: 25,
            amount_cents: 250,
            scan_count: 10,
            status: status.into(),
            paid_at: (status == PAID).then(Utc::now),
            notes: (status == HELD || status == VOIDED).then(|| "Review".to_owned()),
            reviewed_by: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }

    fn clean() -> RiskEvaluation {
        RiskEvaluation::default()
    }

    fn risky() -> RiskEvaluation {
        RiskEvaluation {
            score: 100,
            findings: vec![RiskFinding {
                code: "RAPID_COOKIE_CREATION".into(),
                points: 100,
                affected_scan_ids: vec![],
                evidence: json!({}),
            }],
        }
    }

    fn write(decision: PayoutDecision) -> PayoutWrite {
        match decision {
            PayoutDecision::Insert(write) | PayoutDecision::Update(write) => write,
            PayoutDecision::Keep => panic!("expected a write"),
        }
    }

    #[test]
    fn a_new_payout_freezes_the_current_email_and_rate() {
        let decision = decide_payout(None, "new@example.com", 4, &clean(), &PROMOTER_PROGRAM);
        assert_eq!(
            decision,
            PayoutDecision::Insert(PayoutWrite {
                payout_email: "new@example.com".into(),
                rate_cents: PROMOTER_PROGRAM.rate_cents,
                scan_count: 4,
                amount_cents: 4 * PROMOTER_PROGRAM.rate_cents,
                status: PENDING.into(),
                notes: None,
                reviewed_by: None,
            })
        );
    }

    #[test]
    fn recompute_preserves_frozen_email_and_rate() {
        let existing = PosterPayout {
            payout_email: "frozen@example.com".into(),
            rate_cents: 20,
            amount_cents: 200,
            ..payout(PENDING)
        };
        let update = decide_payout(
            Some(&existing),
            "new@example.com",
            12,
            &clean(),
            &PROMOTER_PROGRAM,
        );
        assert!(matches!(update, PayoutDecision::Update(_)));
        let update = write(update);
        assert_eq!(update.payout_email, "frozen@example.com");
        assert_eq!(update.rate_cents, 20);
        assert_eq!(update.amount_cents, 240);
    }

    #[test]
    fn final_payouts_are_never_changed() {
        for status in [PAID, VOIDED] {
            assert_eq!(
                decide_payout(
                    Some(&payout(status)),
                    "x@example.com",
                    99,
                    &risky(),
                    &PROMOTER_PROGRAM
                ),
                PayoutDecision::Keep
            );
        }
    }

    #[test]
    fn an_identical_recompute_writes_nothing() {
        let existing = payout(PENDING);
        assert_eq!(
            decide_payout(
                Some(&existing),
                "other@example.com",
                10,
                &clean(),
                &PROMOTER_PROGRAM
            ),
            PayoutDecision::Keep
        );
    }

    #[test]
    fn recompute_preserves_manual_hold_review() {
        let existing = PosterPayout {
            notes: Some("Confirm poster placement".into()),
            reviewed_by: Some(USER),
            ..payout(HELD)
        };
        assert_eq!(
            decide_payout(
                Some(&existing),
                "x@example.com",
                10,
                &clean(),
                &PROMOTER_PROGRAM
            ),
            PayoutDecision::Keep
        );
        // A manual hold keeps its notes even when the rules would hold it too.
        assert_eq!(
            decide_payout(
                Some(&existing),
                "x@example.com",
                10,
                &risky(),
                &PROMOTER_PROGRAM
            ),
            PayoutDecision::Keep
        );
    }

    #[test]
    fn automatic_rehold_clears_stale_reviewer() {
        let existing = PosterPayout {
            reviewed_by: Some(USER),
            ..payout(PENDING)
        };
        let update = write(decide_payout(
            Some(&existing),
            "x@example.com",
            10,
            &risky(),
            &PROMOTER_PROGRAM,
        ));
        assert_eq!(update.status, HELD);
        assert_eq!(update.reviewed_by, None);
        assert_eq!(
            update.notes.as_deref(),
            Some("Automatic fraud hold using poster-risk-v1: RAPID_COOKIE_CREATION")
        );
    }

    #[test]
    fn an_automatic_hold_stays_held_and_refreshes_its_notes() {
        let existing = PosterPayout {
            notes: Some("Automatic fraud hold using poster-risk-v0: OLD".into()),
            ..payout(HELD)
        };
        // Clean scans do not release a hold; only an administrator does.
        let kept = decide_payout(
            Some(&existing),
            "x@example.com",
            10,
            &clean(),
            &PROMOTER_PROGRAM,
        );
        assert_eq!(kept, PayoutDecision::Keep);
        let update = write(decide_payout(
            Some(&existing),
            "x@example.com",
            12,
            &risky(),
            &PROMOTER_PROGRAM,
        ));
        assert_eq!(update.status, HELD);
        assert!(update.notes.unwrap().contains("poster-risk-v1"));
    }

    #[test]
    fn the_hold_threshold_is_inclusive() {
        let threshold = PROMOTER_PROGRAM.hold_score_threshold;
        for (score, status) in [(threshold - 1, PENDING), (threshold, HELD)] {
            let evaluation = RiskEvaluation {
                score,
                findings: vec![],
            };
            let decision = write(decide_payout(
                None,
                "x@example.com",
                1,
                &evaluation,
                &PROMOTER_PROGRAM,
            ));
            assert_eq!(decision.status, status, "{score}");
        }
    }

    fn stored(id: usize) -> StoredScan {
        StoredScan {
            scan: PeriodScan {
                id: Uuid::from_u128(id as u128).to_string(),
                dedupe_hash: "v".into(),
                ip_hash: "n".into(),
                scanned_at: Utc::now(),
            },
            risk_flags: json!([]),
        }
    }

    #[test]
    fn scan_risk_groups_keep_first_appearance_order_and_batch_by_500() {
        let scans: Vec<_> = (0..503).map(stored).collect();
        let evaluation = RiskEvaluation {
            score: 7,
            findings: vec![RiskFinding {
                code: "RAPID_COOKIE_CREATION".into(),
                points: 7,
                affected_scan_ids: vec![scans[0].scan.id.clone(), scans[2].scan.id.clone()],
                evidence: json!({"network_reference": "network"}),
            }],
        };
        let groups = scan_risk_groups(&scans, &evaluation);
        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0].0.risk_score, 7);
        assert_eq!(
            groups[0].0.risk_flags,
            vec![
                json!({"code": "RAPID_COOKIE_CREATION", "points": 7, "evidence": {"network_reference": "network"}})
            ]
        );
        assert_eq!(
            groups[0].1,
            vec![scans[0].scan.id.clone(), scans[2].scan.id.clone()]
        );
        assert_eq!(
            groups[1].0,
            ScanRisk {
                risk_score: 0,
                risk_flags: vec![]
            }
        );
        assert_eq!(groups[1].1.len(), 501);
        let chunks: Vec<usize> = groups[1]
            .1
            .chunks(RISK_UPDATE_BATCH)
            .map(<[String]>::len)
            .collect();
        assert_eq!(chunks, [500, 1]);
        for count in [0, 1, 499, 500, 501, 1001] {
            let scans: Vec<_> = (0..count).map(stored).collect();
            let groups = scan_risk_groups(&scans, &clean());
            let total: usize = groups.iter().map(|(_, ids)| ids.len()).sum();
            assert_eq!(total, count);
            let batches: usize = groups
                .iter()
                .map(|(_, ids)| ids.chunks(RISK_UPDATE_BATCH).count())
                .sum();
            assert_eq!(batches, count.div_ceil(RISK_UPDATE_BATCH));
        }
    }

    #[test]
    fn the_summary_prints_like_python_json_dumps() {
        let summary = RunSummary {
            period: "2026-06".into(),
            payouts_written: 2,
            held: 1,
            exported: 1,
            amount_cents: 100,
            csv: "poster-payouts-2026-06.csv".into(),
        };
        assert_eq!(
            summary.to_json(),
            r#"{"amount_cents": 100, "csv": "poster-payouts-2026-06.csv", "exported": 1, "held": 1, "payouts_written": 2, "period": "2026-06"}"#
        );
    }

    #[tokio::test]
    async fn an_open_period_is_refused_before_any_query() {
        // A pool that never connects: the check must come first.
        let pool = sqlx::postgres::PgPoolOptions::new()
            .connect_lazy("postgres://nobody@127.0.0.1:9/none")
            .unwrap();
        let error = run_period(
            &pool,
            NaiveDate::from_ymd_opt(2026, 7, 1).unwrap(),
            chrono::TimeZone::with_ymd_and_hms(&Utc, 2026, 7, 15, 0, 0, 0).unwrap(),
            Path::new("unused.csv"),
            Mode::Live,
            &PROMOTER_PROGRAM,
        )
        .await
        .err()
        .unwrap();
        assert!(error.to_string().contains("has not closed"));
    }

    #[test]
    fn the_csv_is_written_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let directory = tempfile::tempdir().unwrap();
        let output = directory.path().join("nested/payouts.csv");
        write_interac_csv(&[payout(PENDING)], &output).unwrap();
        let contents = std::fs::read_to_string(&output).unwrap();
        assert!(contents.contains("promoter@example.com,2.50,10,pending"));
        assert_eq!(
            std::fs::metadata(&output).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
}
