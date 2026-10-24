import json

import pytest

from jobs import snapshot_instagram_accounts as job


@pytest.mark.parametrize(
    ("tokens", "accounts", "code"),
    [
        ({"failed": 0}, {"captured": 37}, 0),
        ({"failed": 1}, {"captured": 37}, 1),
        ({"failed": 0}, {"captured": 36, "failed": 1}, 1),
    ],
)
def test_job_refreshes_tokens_before_reading_accounts(monkeypatch, capsys, tokens, accounts, code):
    order = []
    monkeypatch.setattr(job, "refresh_expiring_tokens", lambda: order.append("tokens") or tokens)
    monkeypatch.setattr(job, "snapshot_accounts", lambda: order.append("accounts") or accounts)
    assert job.main() == code
    assert order == ["tokens", "accounts"]
    assert json.loads(capsys.readouterr().out) == {"tokens": tokens, "accounts": accounts}
