//! Deterministic, versioned rules for promoter scan risk
//! (`services/poster_risk/evaluator.py`). Scans are never rejected or
//! deleted; a finding adds points to the payout's risk score.

use std::collections::{BTreeSet, HashMap};

use chrono::{DateTime, Utc};
use serde_json::{Value, json};

use crate::controlbox::PromoterProgram;

/// One accepted scan of a payout period, as the rules read it.
#[derive(Debug, Clone, PartialEq)]
pub struct PeriodScan {
    pub id: String,
    pub dedupe_hash: String,
    pub ip_hash: String,
    pub scanned_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RiskFinding {
    pub code: String,
    pub points: i64,
    /// Sorted by id.
    pub affected_scan_ids: Vec<String>,
    pub evidence: Value,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct RiskEvaluation {
    pub score: i64,
    pub findings: Vec<RiskFinding>,
}

/// The rule's code: many new anonymous visitors from one network at once.
pub const RAPID_COOKIE_CREATION: &str = "RAPID_COOKIE_CREATION";

impl RiskEvaluation {
    /// Each scan's flags (`{"code", "points", "evidence"}`), in finding order.
    pub fn flags_by_scan_id(&self) -> HashMap<&str, Vec<Value>> {
        let mut result: HashMap<&str, Vec<Value>> = HashMap::new();
        for finding in &self.findings {
            let flag = json!({
                "code": finding.code,
                "points": finding.points,
                "evidence": finding.evidence,
            });
            for scan_id in &finding.affected_scan_ids {
                result.entry(scan_id).or_default().push(flag.clone());
            }
        }
        result
    }
}

/// `evaluate_period_scans`: one finding per network (keyed IP hash) on which
/// at least `rapid_distinct_visitors` distinct visitors scanned within
/// `rapid_window_seconds` (the window's end is inclusive). Overlapping
/// windows of one network collapse into one finding.
pub fn evaluate_period_scans(scans: &[PeriodScan], control: &PromoterProgram) -> RiskEvaluation {
    // Networks in the order their first scan appears; scans without one are skipped.
    let mut networks: Vec<&str> = Vec::new();
    let mut scans_by_network: HashMap<&str, Vec<&PeriodScan>> = HashMap::new();
    for scan in scans.iter().filter(|scan| !scan.ip_hash.is_empty()) {
        let entry = scans_by_network.entry(&scan.ip_hash).or_default();
        if entry.is_empty() {
            networks.push(&scan.ip_hash);
        }
        entry.push(scan);
    }

    let window = chrono::Duration::seconds(control.rapid_window_seconds);
    let mut findings = Vec::new();
    for network in networks {
        let mut ordered = scans_by_network.remove(network).unwrap_or_default();
        // Stable, like Python's `sorted`: equal times keep their input order.
        ordered.sort_by_key(|scan| scan.scanned_at);

        let mut affected: BTreeSet<&str> = BTreeSet::new();
        let mut maximum_distinct = 0;
        let mut end = 0;
        let mut visitor_counts: HashMap<&str, usize> = HashMap::new();
        for start in 0..ordered.len() {
            let start_time = ordered[start].scanned_at;
            while end < ordered.len() && ordered[end].scanned_at - start_time <= window {
                *visitor_counts.entry(&ordered[end].dedupe_hash).or_default() += 1;
                end += 1;
            }
            let distinct = visitor_counts.len();
            maximum_distinct = maximum_distinct.max(distinct);
            if distinct >= control.rapid_distinct_visitors {
                affected.extend(ordered[start..end].iter().map(|scan| scan.id.as_str()));
            }
            let visitor = ordered[start].dedupe_hash.as_str();
            if let Some(count) = visitor_counts.get_mut(visitor) {
                *count -= 1;
                if *count == 0 {
                    visitor_counts.remove(visitor);
                }
            }
        }

        if !affected.is_empty() {
            findings.push(RiskFinding {
                code: RAPID_COOKIE_CREATION.to_owned(),
                points: control.rapid_rule_points,
                affected_scan_ids: affected.into_iter().map(str::to_owned).collect(),
                evidence: json!({
                    "maximum_distinct_visitors": maximum_distinct,
                    "window_seconds": control.rapid_window_seconds,
                    "network_reference": network.chars().take(12).collect::<String>(),
                }),
            });
        }
    }
    RiskEvaluation {
        score: findings.iter().map(|finding| finding.points).sum(),
        findings,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::controlbox::PROMOTER_PROGRAM;
    use chrono::TimeZone;

    fn start() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 7, 1, 0, 0, 0).unwrap()
    }

    fn scan(index: usize, at: DateTime<Utc>, network: &str) -> PeriodScan {
        PeriodScan {
            id: format!("scan-{index}"),
            dedupe_hash: format!("visitor-{index}"),
            ip_hash: network.to_owned(),
            scanned_at: at,
        }
    }

    fn control(threshold: usize, window_seconds: i64) -> PromoterProgram {
        PromoterProgram {
            rapid_distinct_visitors: threshold,
            rapid_window_seconds: window_seconds,
            ..PROMOTER_PROGRAM.clone()
        }
    }

    #[test]
    fn rapid_cookie_creation_flags_affected_scans() {
        let threshold = PROMOTER_PROGRAM.rapid_distinct_visitors;
        let scans: Vec<_> = (0..threshold)
            .map(|index| {
                scan(
                    index,
                    start() + chrono::Duration::seconds(index as i64),
                    "network",
                )
            })
            .collect();
        let evaluation = evaluate_period_scans(&scans, &PROMOTER_PROGRAM);
        assert_eq!(evaluation.score, PROMOTER_PROGRAM.rapid_rule_points);
        assert_eq!(evaluation.findings[0].code, "RAPID_COOKIE_CREATION");
        assert_eq!(evaluation.flags_by_scan_id().len(), threshold);
        // The production thresholds hold a payout on one finding.
        assert!(evaluation.score >= PROMOTER_PROGRAM.hold_score_threshold);
    }

    #[test]
    fn one_visitor_short_of_the_threshold_is_not_flagged() {
        let threshold = PROMOTER_PROGRAM.rapid_distinct_visitors;
        let mut scans: Vec<_> = (0..threshold - 1)
            .map(|index| scan(index, start(), "network"))
            .collect();
        // A repeat visitor adds a scan but not a distinct visitor.
        let mut repeat = scan(0, start(), "network");
        repeat.id = "repeat".into();
        scans.push(repeat);
        let evaluation = evaluate_period_scans(&scans, &PROMOTER_PROGRAM);
        assert_eq!(evaluation, RiskEvaluation::default());
    }

    #[test]
    fn normal_scan_pacing_has_no_finding() {
        let scans: Vec<_> = (0..PROMOTER_PROGRAM.rapid_distinct_visitors)
            .map(|index| {
                scan(
                    index,
                    start() + chrono::Duration::minutes(index as i64),
                    "network",
                )
            })
            .collect();
        let evaluation = evaluate_period_scans(&scans, &PROMOTER_PROGRAM);
        assert_eq!(evaluation.score, 0);
        assert!(evaluation.findings.is_empty());
    }

    #[test]
    fn scan_window_end_is_inclusive() {
        for (offset, flagged) in [(29, true), (30, true), (31, false)] {
            let scans = vec![
                scan(1, start(), "network"),
                scan(2, start() + chrono::Duration::seconds(offset), "network"),
            ];
            let evaluation = evaluate_period_scans(&scans, &control(2, 30));
            assert_eq!(!evaluation.findings.is_empty(), flagged, "{offset}");
            let mut flagged_ids: Vec<_> = evaluation.flags_by_scan_id().into_keys().collect();
            flagged_ids.sort_unstable();
            let expected: Vec<&str> = if flagged {
                vec!["scan-1", "scan-2"]
            } else {
                vec![]
            };
            assert_eq!(flagged_ids, expected);
        }
    }

    #[test]
    fn scans_without_a_network_and_separate_networks_are_independent() {
        let mut scans: Vec<_> = (0..3).map(|index| scan(index, start(), "")).collect();
        scans.extend((3..5).map(|index| scan(index, start(), "network-a")));
        scans.extend((5..7).map(|index| scan(index, start(), "network-b")));
        let evaluation = evaluate_period_scans(&scans, &control(2, 60));
        assert_eq!(evaluation.findings.len(), 2);
        assert_eq!(evaluation.score, 2 * PROMOTER_PROGRAM.rapid_rule_points);
        assert_eq!(
            evaluation.findings[0].evidence["network_reference"],
            "network-a"
        );
        assert_eq!(
            evaluation.findings[1].affected_scan_ids,
            ["scan-5", "scan-6"]
        );
        // A long hash is shown only by its first 12 characters.
        let long = vec![
            scan(1, start(), &"f".repeat(64)),
            scan(2, start(), &"f".repeat(64)),
        ];
        let evaluation = evaluate_period_scans(&long, &control(2, 60));
        assert_eq!(
            evaluation.findings[0].evidence,
            json!({"maximum_distinct_visitors": 2, "window_seconds": 60, "network_reference": "ffffffffffff"})
        );
    }

    /// The Python test's brute-force reference: every window that starts at a
    /// scan, checked independently.
    fn reference(
        scans: &[PeriodScan],
        threshold: usize,
        window: i64,
        points: i64,
    ) -> Vec<RiskFinding> {
        let mut networks: Vec<&str> = Vec::new();
        for scan in scans {
            if !scan.ip_hash.is_empty() && !networks.contains(&scan.ip_hash.as_str()) {
                networks.push(&scan.ip_hash);
            }
        }
        let mut findings = Vec::new();
        for network in networks {
            let network_scans: Vec<_> = scans
                .iter()
                .filter(|scan| scan.ip_hash == network)
                .collect();
            let mut affected = BTreeSet::new();
            let mut maximum = 0;
            for window_start in &network_scans {
                let inside: Vec<_> = network_scans
                    .iter()
                    .filter(|scan| {
                        scan.scanned_at >= window_start.scanned_at
                            && scan.scanned_at
                                <= window_start.scanned_at + chrono::Duration::seconds(window)
                    })
                    .collect();
                let distinct: BTreeSet<_> = inside.iter().map(|scan| &scan.dedupe_hash).collect();
                maximum = maximum.max(distinct.len());
                if distinct.len() >= threshold {
                    affected.extend(inside.iter().map(|scan| scan.id.clone()));
                }
            }
            if !affected.is_empty() {
                findings.push(RiskFinding {
                    code: RAPID_COOKIE_CREATION.into(),
                    points,
                    affected_scan_ids: affected.into_iter().collect(),
                    evidence: json!({"maximum_distinct_visitors": maximum, "window_seconds": window, "network_reference": network.chars().take(12).collect::<String>()}),
                });
            }
        }
        findings
    }

    #[test]
    fn scan_windows_match_independent_evaluation() {
        // backend/tests/services/test_poster_risk.py::test_scan_windows_match_independent_evaluation
        for seed in 0..16u64 {
            for (threshold, window) in [(2, 1), (3, 30), (8, 300)] {
                let mut random = fastrand::Rng::with_seed(seed);
                let networks = ["network-a", "network-b", ""];
                let mut scans: Vec<PeriodScan> = (0..seed as usize * 3)
                    .map(|index| PeriodScan {
                        id: format!("scan-{index}"),
                        dedupe_hash: format!("visitor-{}", random.usize(0..12)),
                        ip_hash: networks[random.usize(0..3)].to_owned(),
                        scanned_at: start() + chrono::Duration::seconds(random.i64(0..=600)),
                    })
                    .collect();
                random.shuffle(&mut scans);
                let original = scans.clone();
                let control = control(threshold, window);
                let evaluation = evaluate_period_scans(&scans, &control);
                let expected = reference(&scans, threshold, window, control.rapid_rule_points);
                assert_eq!(evaluation.findings, expected, "{seed} {threshold} {window}");
                assert_eq!(
                    evaluation.score,
                    expected.len() as i64 * control.rapid_rule_points
                );
                assert_eq!(scans, original);
            }
        }
    }
}
