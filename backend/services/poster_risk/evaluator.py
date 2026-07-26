"""Deterministic, versioned rules for promoter scan risk."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

from core.controlbox import PromoterProgramControl


@dataclass(frozen=True)
class RiskFinding:
    code: str
    points: int
    affected_scan_ids: tuple[str, ...]
    evidence: dict[str, object]


@dataclass(frozen=True)
class RiskEvaluation:
    score: int
    findings: tuple[RiskFinding, ...]

    @property
    def flags_by_scan_id(self) -> dict[str, list[dict[str, object]]]:
        result: dict[str, list[dict[str, object]]] = {}
        for finding in self.findings:
            flag = {
                "code": finding.code,
                "points": finding.points,
                "evidence": finding.evidence,
            }
            for scan_id in finding.affected_scan_ids:
                result.setdefault(scan_id, []).append(flag)
        return result


def evaluate_period_scans(
    scans: list[dict],
    control: PromoterProgramControl,
) -> RiskEvaluation:
    """Evaluate accepted scans without rejecting or deleting them.

    The first rule detects many anonymous visitor identities appearing from
    one keyed IP hash inside a short window. Overlapping windows for the same
    IP are collapsed into one stable finding.
    """
    findings: list[RiskFinding] = []
    scans_by_ip: dict[str, list[dict]] = {}
    for scan in scans:
        ip_hash = scan.get("ip_hash")
        if ip_hash:
            scans_by_ip.setdefault(str(ip_hash), []).append(scan)

    window = timedelta(seconds=control.rapid_window_seconds)
    for ip_hash, ip_scans in scans_by_ip.items():
        ordered = sorted(ip_scans, key=lambda row: _as_datetime(row["scanned_at"]))
        affected_ids: set[str] = set()
        maximum_distinct = 0

        end = 0
        visitor_counts: dict[str, int] = {}
        for start, start_scan in enumerate(ordered):
            if end < start:
                end = start
            while end < len(ordered):
                candidate_time = _as_datetime(ordered[end]["scanned_at"])
                if candidate_time - _as_datetime(start_scan["scanned_at"]) > window:
                    break
                visitor = str(ordered[end]["dedupe_hash"])
                visitor_counts[visitor] = visitor_counts.get(visitor, 0) + 1
                end += 1

            distinct_count = len(visitor_counts)
            maximum_distinct = max(maximum_distinct, distinct_count)
            if distinct_count >= control.rapid_distinct_visitors:
                affected_ids.update(str(row["id"]) for row in ordered[start:end])

            starting_visitor = str(start_scan["dedupe_hash"])
            visitor_counts[starting_visitor] -= 1
            if visitor_counts[starting_visitor] == 0:
                visitor_counts.pop(starting_visitor)

        if affected_ids:
            findings.append(
                RiskFinding(
                    code="RAPID_COOKIE_CREATION",
                    points=control.rapid_rule_points,
                    affected_scan_ids=tuple(sorted(affected_ids)),
                    evidence={
                        "maximum_distinct_visitors": maximum_distinct,
                        "window_seconds": control.rapid_window_seconds,
                        "network_reference": ip_hash[:12],
                    },
                )
            )

    return RiskEvaluation(
        score=sum(finding.points for finding in findings),
        findings=tuple(findings),
    )


def _as_datetime(value: object) -> datetime:
    if isinstance(value, datetime):
        return value
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
