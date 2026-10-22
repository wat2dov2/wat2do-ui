from contextlib import nullcontext
from dataclasses import replace
from datetime import datetime
from types import SimpleNamespace

import pytest

from services.instagram_dms import sweep as module
from services.instagram_emulator.inbox import InboxRow
from services.instagram_notifications.browser_session import BrowserEngagementUncertain

THEIRS = InboxRow("club", "Could you share this?", 0.5, unread=True, request=False)
OURS = InboxRow("friend", "You: Sure!", 0.5, unread=False, request=False)
OLD = InboxRow("old", "Share this?", 30, unread=True, request=False)
REQUEST = InboxRow("stranger", "Hi! Can you post our event?", 1, unread=True, request=True)


class _Device:
    def wake(self):
        pass

    def use_android_user(self, user):
        pass

    def use_account(self, user, account):
        pass


@pytest.fixture
def emulator(monkeypatch, tmp_path):
    handled = []
    monkeypatch.setattr(module, "STATE_PATH", tmp_path / "sweep.json")
    monkeypatch.setattr(module, "exclusive", nullcontext)
    monkeypatch.setattr(module, "EmulatorDevice", _Device)
    monkeypatch.setattr(
        module, "EMULATOR", SimpleNamespace(android_user_by_school={"ubc": 11, "sfu": 11})
    )
    monkeypatch.setattr(
        module.school_service, "get_school", lambda slug: SimpleNamespace(name=slug.upper())
    )
    monkeypatch.setattr(
        module,
        "read_inbox",
        # The "All" tab lists the request too, as a plain thread.
        lambda device, user, requests: (
            [REQUEST] if requests else [THEIRS, OURS, OLD, replace(REQUEST, request=False)]
        ),
    )

    class _Executor:
        def handle(self, row, **kwargs):
            assert row.request == (row.name == "stranger")
            handled.append((kwargs["school"], row.name, kwargs["dry_run"]))
            return {"status": "replied", "outcome": "add_to_post"}

    monkeypatch.setattr(module, "EmulatorDirectExecutor", _Executor)
    return handled


def test_a_sweep_answers_new_threads_once_and_schedules_the_next(emulator) -> None:
    result = module.sweep()
    assert result == {"status": "swept", "replied": 4, "failed": []}
    assert sorted(name for _school, name, _dry in emulator) == [
        "club",
        "club",
        "stranger",
        "stranger",
    ]
    assert all(dry is module.CONTROL.dry_run for _school, _name, dry in emulator)
    emulator.clear()
    # Nothing new arrived, so a second sweep reads the inboxes but answers nothing.
    assert module.sweep()["status"] == "swept" and emulator == []
    assert module._load()["next_run_at"] > datetime.now().timestamp()


def test_an_unconfirmed_answer_pauses_every_later_run(emulator, monkeypatch) -> None:
    class _Uncertain:
        def handle(self, row, **kwargs):
            raise BrowserEngagementUncertain("Instagram DM reply is uncertain")

    monkeypatch.setattr(module, "EmulatorDirectExecutor", _Uncertain)
    assert module.sweep()["status"] == "paused"
    assert module.run_if_due() == {"status": "paused", "reason": "Instagram DM reply is uncertain"}
    module.resume()
    assert "paused" not in module._load()


def test_one_broken_account_does_not_stop_the_others(emulator, monkeypatch) -> None:
    def read_inbox(device, user, requests):
        raise module.EmulatorError("Instagram never showed the inbox")

    monkeypatch.setattr(module, "read_inbox", read_inbox)
    result = module.sweep()
    assert result["status"] == "swept" and sorted(result["failed"]) == ["sfu", "ubc"]


def test_run_waits_for_its_random_time(emulator) -> None:
    module._save({"next_run_at": datetime.now().timestamp() + 3600})
    assert module.run_if_due()["status"] == "waiting"
    assert emulator == []


@pytest.mark.parametrize("hour", [0, 8, 23])
def test_the_next_run_always_lands_in_waking_hours(hour) -> None:
    moment = datetime(2026, 10, 22, hour, 30).astimezone()
    for _ in range(50):
        later = module._next_run(moment)
        assert later > moment
        assert module._waking_hours(later)
