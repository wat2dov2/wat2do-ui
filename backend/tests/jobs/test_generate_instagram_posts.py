import json

from jobs import generate_instagram_posts


def test_daily_job_refreshes_tokens_before_generating_batches(monkeypatch, capsys):
    calls = []
    monkeypatch.setattr(
        generate_instagram_posts,
        "refresh_expiring_tokens",
        lambda now: calls.append(("refresh", now)) or {"due": 1, "refreshed": 1, "failed": 0},
    )
    monkeypatch.setattr(
        generate_instagram_posts,
        "generate_due_batches",
        lambda now: (
            calls.append(("generate", now))
            or {
                "accounts": 24,
                "generated": 24,
                "empty": 0,
                "skipped": 0,
                "failed": 0,
            }
        ),
    )

    assert generate_instagram_posts.main() == 0
    assert [name for name, _ in calls] == ["refresh", "generate"]
    assert calls[0][1] is calls[1][1]
    output = json.loads(capsys.readouterr().out)
    assert output["token_refresh"]["refreshed"] == 1
    assert output["generation"]["generated"] == 24


def test_daily_job_alerts_through_failure_exit_after_refresh_error(monkeypatch):
    monkeypatch.setattr(
        generate_instagram_posts,
        "refresh_expiring_tokens",
        lambda _now: {"due": 1, "refreshed": 0, "failed": 1},
    )
    monkeypatch.setattr(
        generate_instagram_posts,
        "generate_due_batches",
        lambda _now: {
            "accounts": 24,
            "generated": 24,
            "empty": 0,
            "skipped": 0,
            "failed": 0,
        },
    )

    assert generate_instagram_posts.main() == 1
