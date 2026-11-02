//! `wat2do-poster-payouts`: freeze one closed UTC month's promoter poster
//! payouts and write the Interac CSV (`poster_payouts::run`).
//! `.github/workflows/monthly-poster-payouts.yml` runs it on the first of
//! each month for the month before.
//!
//! `--plan` reads the database read-only and prints, as JSON, every payout
//! and scan risk the run would write, writing nothing.

use std::path::PathBuf;
use std::sync::LazyLock;

use anyhow::{Context, Result};
use chrono::{DateTime, Datelike, NaiveDate, Utc};
use clap::Parser;
use regex::Regex;
use wat2do::controlbox::PROMOTER_PROGRAM;
use wat2do::poster_payouts::run::{Mode, run_period};

/// `strptime(value, "%Y-%m")`: four year digits, a month of one or two digits.
static PERIOD: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(\d{4})-(1[0-2]|0[1-9]|[1-9])$").expect("period pattern"));

fn parse_period(value: &str) -> Result<NaiveDate, String> {
    let captures = PERIOD
        .captures(value)
        .ok_or_else(|| "period must use YYYY-MM".to_owned())?;
    let year: i32 = captures[1].parse().map_err(|_| "period must use YYYY-MM")?;
    let month: u32 = captures[2].parse().map_err(|_| "period must use YYYY-MM")?;
    NaiveDate::from_ymd_opt(year, month, 1).ok_or_else(|| "period must use YYYY-MM".to_owned())
}

/// The first day of the month before `now`'s UTC month.
fn previous_month(now: DateTime<Utc>) -> NaiveDate {
    let first = now.date_naive().with_day(1).expect("the first of a month");
    first
        .pred_opt()
        .and_then(|last| last.with_day(1))
        .expect("the month before exists")
}

#[derive(Parser)]
#[command(about = "Compute promoter poster payouts for one closed UTC month")]
struct Cli {
    /// The month to pay (YYYY-MM); the previous month by default
    #[arg(long, value_parser = parse_period)]
    period: Option<NaiveDate>,
    /// CSV output path. Defaults to poster-payouts-YYYY-MM.csv.
    #[arg(long)]
    output: Option<PathBuf>,
    /// Write nothing: read the database read-only and print every payout and
    /// scan risk the run would write
    #[arg(long)]
    plan: bool,
}

#[tokio::main]
async fn main() -> Result<()> {
    wat2do::install_tls();
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,sqlx=warn".into()),
        )
        .with_writer(std::io::stderr)
        .init();
    let now = Utc::now();
    let cli = Cli::parse();
    let period = cli.period.unwrap_or_else(|| previous_month(now));
    let output = cli
        .output
        .unwrap_or_else(|| PathBuf::from(format!("poster-payouts-{}.csv", period.format("%Y-%m"))));
    let (pool, mode) = if cli.plan {
        let pool = wat2do::db::connect_read_only(2).await?;
        let setting: String = sqlx::query_scalar("SHOW default_transaction_read_only")
            .fetch_one(&pool)
            .await?;
        anyhow::ensure!(setting == "on", "the plan connection is not read-only");
        (pool, Mode::Plan)
    } else {
        (wat2do::db::connect(2).await?, Mode::Live)
    };
    let outcome = run_period(&pool, period, now, &output, mode, &PROMOTER_PROGRAM)
        .await
        .context("poster payout run failed")?;
    if mode == Mode::Plan {
        println!("{}", serde_json::to_string_pretty(&outcome.plan)?);
    }
    println!("{}", outcome.summary.to_json());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn periods_read_like_strptime() {
        assert_eq!(
            parse_period("2026-06"),
            Ok(NaiveDate::from_ymd_opt(2026, 6, 1).unwrap())
        );
        assert_eq!(
            parse_period("2026-6"),
            Ok(NaiveDate::from_ymd_opt(2026, 6, 1).unwrap())
        );
        for bad in ["2026-13", "2026-00", "26-06", "2026-06-01", "June", ""] {
            assert_eq!(
                parse_period(bad),
                Err("period must use YYYY-MM".to_owned()),
                "{bad}"
            );
        }
    }

    #[test]
    fn the_default_period_is_the_previous_month() {
        let at = |y, m, d| Utc.with_ymd_and_hms(y, m, d, 1, 15, 0).unwrap();
        assert_eq!(
            previous_month(at(2026, 7, 1)),
            NaiveDate::from_ymd_opt(2026, 6, 1).unwrap()
        );
        assert_eq!(
            previous_month(at(2027, 1, 1)),
            NaiveDate::from_ymd_opt(2026, 12, 1).unwrap()
        );
        assert_eq!(
            previous_month(at(2026, 3, 31)),
            NaiveDate::from_ymd_opt(2026, 2, 1).unwrap()
        );
    }
}
