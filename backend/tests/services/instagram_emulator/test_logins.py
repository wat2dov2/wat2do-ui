import json
import subprocess

from services.instagram_emulator import logins


def _guard(monkeypatch, tripped):
    calls = []

    def run(command, **_kwargs):
        calls.append(command)
        account = command[command.index("--account") + 1]
        answer = {account: {"tripped": tripped, "reads_today": 0}}
        return subprocess.CompletedProcess(command, 0, stdout=json.dumps(answer), stderr="")

    monkeypatch.setattr(logins.subprocess, "run", run)
    return calls


def test_an_account_whose_breaker_is_open_may_not_log_in(monkeypatch) -> None:
    _guard(monkeypatch, "Instagram 'Confirm you're human' checkpoint")
    blocked = logins.login_blocked("wat2do.sfu")
    assert blocked == (
        "its account-guard breaker is open: Instagram 'Confirm you're human' checkpoint"
    )


def test_an_account_resting_after_a_challenge_may_not_log_in(monkeypatch) -> None:
    _guard(monkeypatch, None)
    from services.instagram_sessions import notification

    monkeypatch.setattr(notification, "paused_until", lambda school: "2026-11-29T00:00:00+00:00")
    assert "rests until 2026-11-29" in (logins.login_blocked("wat2do.sfu") or "")


def test_a_healthy_account_may_log_in(monkeypatch) -> None:
    _guard(monkeypatch, None)
    from services.instagram_sessions import notification

    monkeypatch.setattr(notification, "paused_until", lambda school: None)
    assert logins.login_blocked("wat2do.mun") is None


def test_a_guard_that_cannot_be_read_blocks_the_login(monkeypatch) -> None:
    def run(command, **_kwargs):
        raise subprocess.CalledProcessError(1, command)

    monkeypatch.setattr(logins.subprocess, "run", run)
    assert logins.login_blocked("wat2do.mun") == (
        "its account guard could not be read (CalledProcessError)"
    )


def test_holding_an_account_opens_its_breaker(monkeypatch) -> None:
    calls = _guard(monkeypatch, "checkpoint")
    logins.hold_for_person("wat2do.sfu", "checkpoint")
    assert calls[0][-4:] == ["--account", "wat2do.sfu", "--trip", "checkpoint"]
