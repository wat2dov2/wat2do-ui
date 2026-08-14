import json
from types import SimpleNamespace

from scripts import manage_instagram_digest_sessions as script
from services.instagram_digest.sessions import RoutedSessionHealth


def test_store_prompts_for_secrets_instead_of_accepting_them_in_argv(monkeypatch, capsys):
    answers = iter(["12345:session-secret", "matching-browser-agent"])
    imported = script.InstagramSession(
        intended_recipient_id="12345",
        sessionid="12345:session-secret",
        csrftoken="csrf-secret",
        ds_user_id="12345",
        user_agent="matching-browser-agent",
        account_username="ubc.wat2do.io",
    )
    stored = []

    def prime(sessionid, user_agent, *, timeout_seconds):
        assert sessionid == "12345:session-secret"
        assert user_agent == "matching-browser-agent"
        assert timeout_seconds == 30
        return imported

    monkeypatch.setattr(script.getpass, "getpass", lambda _prompt: next(answers))
    monkeypatch.setattr(script, "prime_browser_session", prime)
    monkeypatch.setattr(
        script,
        "KeychainSessionStore",
        lambda: SimpleNamespace(store=stored.append),
    )

    assert script.main(["store", "12345"]) == 0
    assert stored == [imported]
    assert "secret" not in capsys.readouterr().out


def test_remove_is_idempotent_when_keychain_item_is_already_missing(monkeypatch, capsys):
    class _Store:
        def delete(self, _recipient_id):
            return None

    monkeypatch.setattr(script, "KeychainSessionStore", _Store)

    assert script.main(["remove", "12345", "--yes"]) == 0
    assert "Removed" in capsys.readouterr().out


def test_health_writes_allowlisted_report_after_all_failures(monkeypatch, tmp_path, capsys):
    report_file = tmp_path / "health.json"
    audit = script.SessionHealthAudit(
        healthy=False,
        issues=(script.SessionHealthIssue.KEYCHAIN_INDEX_INVALID,),
        sessions=(
            RoutedSessionHealth(
                school="ubc",
                intended_recipient_id="12345",
                account_username="ubc.wat2do.io",
                status=script.SessionHealthStatus.REAUTHORIZATION_REQUIRED,
                issue=script.SessionHealthIssue.REMOTE_CHECK_FAILED,
            ),
        ),
    )
    monkeypatch.setattr(script, "_health_audit", lambda _store: audit)
    monkeypatch.setattr(script, "KeychainSessionStore", object)

    assert script.main(["health", "--report-file", str(report_file)]) == 1

    report = json.loads(report_file.read_text(encoding="utf-8"))
    assert set(report) == {"healthy", "issues", "sessions"}
    assert set(report["sessions"][0]) == {
        "school",
        "intended_recipient_id",
        "account_username",
        "status",
        "issue",
    }
    assert "secret" not in report_file.read_text(encoding="utf-8")
    assert "failed" in capsys.readouterr().out


def test_health_still_writes_sanitized_report_after_unexpected_audit_failure(
    monkeypatch,
    tmp_path,
):
    report_file = tmp_path / "health.json"
    monkeypatch.setattr(
        script,
        "audit_notification_sessions",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("secret detail")),
    )
    monkeypatch.setattr(script, "KeychainSessionStore", object)

    assert script.main(["health", "--report-file", str(report_file)]) == 1
    assert json.loads(report_file.read_text(encoding="utf-8")) == {
        "healthy": False,
        "issues": ["audit_failed"],
        "sessions": [],
    }
    assert "secret" not in report_file.read_text(encoding="utf-8")
