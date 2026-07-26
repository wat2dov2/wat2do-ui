from datetime import datetime, timedelta, timezone

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
