import subprocess
from datetime import datetime, timezone
from email.message import EmailMessage
from email.utils import format_datetime

from services.instagram_notifications import account_login as module


def test_canonical_account_maps_switcher_names_to_school_accounts():
    assert module.canonical_account("tmu.wat2do.io") == "wat2do.tmu"
    assert module.canonical_account("wat2do.ca") == "wat2do.uwaterloo"
    assert module.canonical_account("wat2do.guelph") == "wat2do.guelph"


def test_account_password_reads_the_keychain_and_is_none_when_missing(monkeypatch):
    calls = []

    def run(arguments, **kwargs):
        calls.append(arguments)
        found = arguments[arguments.index("-a") + 1] == "wat2do.guelph"
        return subprocess.CompletedProcess(
            arguments, 0 if found else 44, stdout="pw\n" if found else ""
        )

    monkeypatch.setattr(module.subprocess, "run", run)

    assert module.account_password("wat2do.guelph") == "pw"
    assert module.account_password("wat2do.brocku") is None
    assert calls[0][:3] == ["/usr/bin/security", "find-generic-password", "-s"]


def _email(body, sent):
    message = EmailMessage()
    message["Date"] = format_datetime(datetime.fromtimestamp(sent, timezone.utc))
    message.set_content(body)
    return message


def test_code_in_message_takes_only_a_new_code_for_the_account():
    body = "Hi wat2do.ucalgary, 482913 is your Instagram security code."

    assert module.code_in_message(_email(body, 1000), "wat2do.ucalgary", 1000) == "482913"
    assert module.code_in_message(_email(body, 500), "wat2do.ucalgary", 1000) is None
    assert module.code_in_message(_email(body, 1000), "wat2do.guelph", 1000) is None
