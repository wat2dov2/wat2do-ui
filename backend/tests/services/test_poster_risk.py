from copy import deepcopy
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from random import Random

import pytest

from core.controlbox import controlbox
from services.poster_risk import evaluate_period_scans


def _scan(index: int, scanned_at: datetime, *, ip_hash: str = "network") -> dict:
    return {
        "id": f"scan-{index}",
        "dedupe_hash": f"visitor-{index}",
        "ip_hash": ip_hash,
        "scanned_at": scanned_at,
    }


def test_rapid_cookie_creation_flags_affected_scans():
    start = datetime(2026, 7, 1, tzinfo=timezone.utc)
    threshold = controlbox.promoter_program.rapid_distinct_visitors
    scans = [_scan(index, start + timedelta(seconds=index)) for index in range(threshold)]

    evaluation = evaluate_period_scans(scans, controlbox.promoter_program)

    assert evaluation.score == controlbox.promoter_program.rapid_rule_points
    assert evaluation.findings[0].code == "RAPID_COOKIE_CREATION"
    assert len(evaluation.flags_by_scan_id) == threshold


def test_normal_scan_pacing_has_no_finding():
    start = datetime(2026, 7, 1, tzinfo=timezone.utc)
    scans = [
        _scan(index, start + timedelta(minutes=index))
        for index in range(controlbox.promoter_program.rapid_distinct_visitors)
    ]

    evaluation = evaluate_period_scans(scans, controlbox.promoter_program)

    assert evaluation.score == 0
    assert evaluation.findings == ()


@pytest.mark.parametrize("seed", range(16))
@pytest.mark.parametrize("threshold,window_seconds", [(2, 1), (3, 30), (8, 300)])
def test_scan_windows_match_independent_evaluation(seed, threshold, window_seconds):
    random = Random(seed)
    start = datetime(2026, 7, 1, tzinfo=timezone.utc)
    control = controlbox.promoter_program.model_copy(
        update={
            "rapid_distinct_visitors": threshold,
            "rapid_window_seconds": window_seconds,
        }
    )
    scans = []
    for index in range(seed * 3):
        timestamp = start + timedelta(seconds=random.randrange(0, 601))
        row = _scan(index, timestamp, ip_hash=random.choice(["network-a", "network-b", ""]))
        row["dedupe_hash"] = f"visitor-{random.randrange(12)}"
        if index % 3 == 0:
            row["scanned_at"] = timestamp.isoformat()
        elif index % 3 == 1:
            row["scanned_at"] = timestamp.isoformat().replace("+00:00", "Z")
        scans.append(row)
    random.shuffle(scans)
    original = deepcopy(scans)

    expected_findings = []
    for network in dict.fromkeys(row["ip_hash"] for row in scans if row["ip_hash"]):
        network_scans = [row for row in scans if row["ip_hash"] == network]
        timestamps = [
            datetime.fromisoformat(str(row["scanned_at"]).replace("Z", "+00:00"))
            for row in network_scans
        ]
        affected = set()
        maximum_distinct = 0
        for window_start in timestamps:
            rows_in_window = [
                row
                for row, timestamp in zip(network_scans, timestamps, strict=True)
                if window_start <= timestamp <= window_start + timedelta(seconds=window_seconds)
            ]
            distinct = len({row["dedupe_hash"] for row in rows_in_window})
            maximum_distinct = max(maximum_distinct, distinct)
            if distinct >= threshold:
                affected.update(row["id"] for row in rows_in_window)
        if affected:
            expected_findings.append(
                {
                    "code": "RAPID_COOKIE_CREATION",
                    "points": control.rapid_rule_points,
                    "affected_scan_ids": tuple(sorted(affected)),
                    "evidence": {
                        "maximum_distinct_visitors": maximum_distinct,
                        "window_seconds": window_seconds,
                        "network_reference": network[:12],
                    },
                }
            )

    evaluation = evaluate_period_scans(scans, control)

    assert [asdict(finding) for finding in evaluation.findings] == expected_findings
    assert evaluation.score == len(expected_findings) * control.rapid_rule_points
    assert scans == original


@pytest.mark.parametrize("offset_seconds,flagged", [(29, True), (30, True), (31, False)])
def test_scan_window_end_is_inclusive(offset_seconds, flagged):
    start = datetime(2026, 7, 1, tzinfo=timezone.utc)
    control = controlbox.promoter_program.model_copy(
        update={"rapid_distinct_visitors": 2, "rapid_window_seconds": 30}
    )
    scans = [_scan(1, start), _scan(2, start + timedelta(seconds=offset_seconds))]

    evaluation = evaluate_period_scans(scans, control)

    assert bool(evaluation.findings) is flagged
    assert set(evaluation.flags_by_scan_id) == ({"scan-1", "scan-2"} if flagged else set())
