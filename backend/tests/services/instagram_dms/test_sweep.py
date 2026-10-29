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
# A read thread shows who is active, not its latest message.
ACTIVE = InboxRow("quiet", "Active 2h ago", None, unread=False, request=False)
REQUEST = InboxRow("stranger", "Hi! Can you post our event?", 1, unread=True, request=True)


DEVICE = object()


@pytest.fixture
def emulator(monkeypatch, tmp_path):
    handled = []
    monkeypatch.setattr(module, "STATE_PATH", tmp_path / "sweep.json")
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
            [REQUEST] if requests else [THEIRS, OURS, OLD, ACTIVE, replace(REQUEST, request=False)]
        ),
    )

    class _Executor:
        def __init__(self, device):
            assert device is DEVICE

        def handle(self, row, **kwargs):
            assert row.request == (row.name == "stranger")
            handled.append((kwargs["school"], row.name, kwargs["dry_run"]))
            return {"status": "replied", "outcome": "feature"}

    monkeypatch.setattr(module, "EmulatorDirectExecutor", _Executor)
    return handled


def test_an_account_answers_new_threads_once_and_schedules_its_next_check(emulator) -> None:
    assert module.due("ubc")
    assert module.answer(DEVICE, "ubc") == ["replied"] * 3
    assert sorted(name for _school, name, _dry in emulator) == ["club", "quiet", "stranger"]
    assert all(dry is module.CONTROL.dry_run for _school, _name, dry in emulator)
    emulator.clear()
    # Nothing new arrived, so a second check reads the inbox but answers nothing.
    assert module.answer(DEVICE, "ubc") == [] and emulator == []
    later = module._load()["next_check_at"]["ubc"]
    assert later > datetime.now().timestamp()
    # Each account keeps its own random time.
    assert not module.due("ubc") and module.due("sfu")
    assert module.due("ubc", datetime.fromtimestamp(later + 1).astimezone())


def test_an_unconfirmed_answer_pauses_every_inbox(emulator, monkeypatch) -> None:
    class _Uncertain:
        def __init__(self, device):
            pass

        def handle(self, row, **kwargs):
            raise BrowserEngagementUncertain("Instagram DM reply is uncertain")

    monkeypatch.setattr(module, "EmulatorDirectExecutor", _Uncertain)
    with pytest.raises(BrowserEngagementUncertain):
        module.answer(DEVICE, "ubc")
    assert module.paused() == "Instagram DM reply is uncertain"
    assert not module.due("sfu")
    module.resume()
    assert module.paused() is None and module.due("sfu")


def test_a_read_thread_is_opened_once_and_again_only_when_unread() -> None:
    read = InboxRow("club", "Active now", None, unread=False, request=False)
    assert module._needs_answer(read, {})
    assert not module._needs_answer(read, {"club": "Could you share this?"})
    assert not module._needs_answer(OURS, {})
    assert module._needs_answer(THEIRS, {"club": "an older message"})
    assert not module._needs_answer(THEIRS, {"club": THEIRS.preview})
    assert not module._needs_answer(OLD, {})
