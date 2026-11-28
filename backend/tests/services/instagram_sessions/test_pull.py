import contextlib
import json
import subprocess
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from core.controlbox import controlbox
from services.instagram_sessions import pull

NOW = datetime(2026, 11, 28, 15, 20, tzinfo=timezone.utc)
SCHOOLS = {"berkeley": 13, "mit": 12, "tmu": 11, "udem": 11, "sfu": 11}


@pytest.fixture(autouse=True)
def isolated(monkeypatch, tmp_path):
    monkeypatch.setattr(pull, "STATE_DIR", tmp_path / "pull")
    monkeypatch.setattr(pull, "_STATE", tmp_path / "pull/state.json")
    monkeypatch.setattr(pull, "SITTING_LOG", tmp_path / "sittings")
    monkeypatch.setattr(pull.notification, "STATE_DIR", tmp_path / "agent")
    emulator = controlbox.instagram_emulator.model_copy(update={"android_user_by_school": SCHOOLS})
    monkeypatch.setattr(
        pull,
        "controlbox",
        SimpleNamespace(
            instagram_emulator=emulator,
            instagram_sessions=controlbox.instagram_sessions,
            notification_recording=controlbox.notification_recording,
        ),
    )
    heard = {
        "wat2do.berkeley": NOW - timedelta(days=10),
        "wat2do.tmu": NOW - timedelta(hours=1),
        "wat2do.sfu": NOW - timedelta(days=2),
        # mit: nothing in the recorder's file at all.
    }
    monkeypatch.setattr(
        pull.notification_recording,
        "read_recorded",
        lambda: SimpleNamespace(by_account=heard),
    )
    monkeypatch.setattr(
        pull.notification,
        "school_skipped",
        lambda school: "no DMs on French schools (schools.language)" if school == "udem" else "",
    )
    monkeypatch.setattr(
        pull.logins, "breaker", lambda account: "checkpoint" if account == "wat2do.sfu" else None
    )
    monkeypatch.setattr(pull.time, "sleep", lambda _seconds: None)


@pytest.fixture
def sent(monkeypatch):
    bodies: list[dict] = []
    monkeypatch.setattr(pull, "dispatch", bodies.append)
    return bodies


def _inbox(monkeypatch, threads=(), posts=()):
    reads: list[str] = []

    def read(school, account):
        reads.append(school)
        return list(threads), list(posts)

    monkeypatch.setattr(pull, "_read", read)
    return reads


def _thread(name, *, unread=True, request=False):
    return {"name": name, "preview": "PRIVATE_TEXT", "unread": unread, "request": request}


def _write(directory, entries, day="2026-11-28"):
    directory.mkdir(parents=True, exist_ok=True)
    (directory / f"{day}.jsonl").write_text("".join(json.dumps(e) + "\n" for e in entries))


def test_only_silent_accounts_the_agent_would_handle_are_read(monkeypatch, sent):
    reads = _inbox(monkeypatch)
    lines = {line["school"]: line for line in pull.run(now=NOW)}
    assert reads == ["berkeley", "mit"]
    assert lines["tmu"]["why"] == "heard lately"
    assert lines["udem"]["why"].startswith("no DMs on French schools")
    assert lines["sfu"]["why"] == "its account-guard breaker is open"
    assert lines["mit"]["silent_hours"] is None and lines["mit"]["outcome"] == "read"
    assert lines["berkeley"]["silent_hours"] == 240.0


def test_asking_for_a_school_reads_it_even_when_heard_lately(monkeypatch, sent):
    reads = _inbox(monkeypatch)
    pull.run(schools=["tmu", "udem"], now=NOW)
    assert reads == ["tmu"]


def test_unread_threads_and_requests_go_to_the_agent_once(monkeypatch, sent, tmp_path):
    threads = [
        _thread("Berkeley Chess Club"),
        _thread("newclub_ucb", request=True),
        _thread("Old Friend", unread=False),
        _thread("Handled Club"),
        _thread("Replied Club"),
    ]
    _write(
        tmp_path / "agent",
        [
            {
                "school": "berkeley",
                "category": "direct_v2_text",
                "sender": "Handled Club",
                "ended": (NOW - timedelta(hours=1)).isoformat(),
            }
        ],
    )
    _write(
        tmp_path / "sittings",
        [
            {
                "school": "berkeley",
                "move": "read",
                "thread": "Replied Club",
                "ok": True,
                "ended": (NOW - timedelta(minutes=30)).isoformat(),
            }
        ],
    )
    _inbox(monkeypatch, threads)
    lines = {line["school"]: line for line in pull.run(schools=["berkeley"], now=NOW)}

    assert [body["client_payload"] for body in sent] == [
        {
            "category": "direct_v2_text",
            "account": "wat2do.berkeley",
            "sender": "Berkeley Chess Club",
            "received_at": "2026-11-28T15:20:00+00:00",
        },
        {
            "category": "direct_v2_pending",
            "account": "wat2do.berkeley",
            "sender": "newclub_ucb",
            "received_at": "2026-11-28T15:20:00+00:00",
        },
    ]
    assert all(body["event_type"] == "instagram_interaction" for body in sent)
    line = lines["berkeley"]
    assert (line["threads"], line["unread"], line["requests"]) == (5, 4, 1)
    assert (line["dispatched"], line["already_handled"]) == (2, 2)

    # Still unread an hour later: their runs are on their way, so nothing goes again.
    sent.clear()
    pull.run(schools=["berkeley"], now=NOW + timedelta(hours=2))
    assert sent == []

    # Handled since, and unread again once the repeat window passed: a new message.
    later = NOW + timedelta(hours=6)
    _inbox(
        monkeypatch,
        [_thread("Berkeley Chess Club"), *[{**thread, "unread": False} for thread in threads[1:]]],
    )
    _write(
        tmp_path / "agent",
        [
            {
                "school": "berkeley",
                "category": "direct_v2_text",
                "sender": "Berkeley Chess Club",
                "ended": (NOW + timedelta(hours=1)).isoformat(),
            }
        ],
    )
    pull.run(schools=["berkeley"], now=later)
    assert [body["client_payload"]["sender"] for body in sent] == ["Berkeley Chess Club"]


def test_the_log_keeps_counts_never_names_or_text(monkeypatch, sent, tmp_path):
    _inbox(monkeypatch, [_thread("Berkeley Chess Club")])
    pull.run(schools=["berkeley"], now=NOW)
    logged = (tmp_path / "pull/2026-11-28.jsonl").read_text()
    assert "Chess" not in logged and "PRIVATE_TEXT" not in logged
    assert json.loads(logged)["dispatched"] == 1
    assert (tmp_path / "pull/state.json").stat().st_mode & 0o077 == 0


def test_new_comments_go_to_the_agent_once_per_author(monkeypatch, sent, tmp_path):
    post = "https://www.instagram.com/p/ABC/"
    comments = [
        {"author": "fan_one", "liked": False, "pinned": False},
        {"author": "wat2do.berkeley", "liked": False, "pinned": False},
        {"author": "liked_already", "liked": True, "pinned": False},
        {"author": "handled_fan", "liked": False, "pinned": False},
    ]
    other = "https://www.instagram.com/p/DEF/"
    posts = [
        {"post": post, "comments": comments},
        {"post": other, "comments": [{"author": "fan_one", "liked": False, "pinned": False}]},
    ]
    _write(
        tmp_path / "agent",
        [
            {
                "school": "berkeley",
                "category": "comment",
                "sender": "handled_fan",
                "ended": (NOW - timedelta(days=3)).isoformat(),
            }
        ],
        day="2026-11-25",
    )
    _inbox(monkeypatch, posts=posts)
    pull.run(schools=["berkeley"], now=NOW)
    assert [(b["client_payload"]["category"], b["client_payload"]["sender"]) for b in sent] == [
        ("comment", "fan_one")
    ]
    sent.clear()
    pull.run(schools=["berkeley"], now=NOW + timedelta(days=2))
    assert sent == []


def test_dispatches_past_the_cap_wait_for_the_next_run(monkeypatch, sent):
    monkeypatch.setattr(
        pull, "CONTROL", pull.CONTROL.model_copy(update={"dispatches_per_account": 1})
    )
    _inbox(monkeypatch, [_thread("One"), _thread("Two")])
    [line] = pull.run(schools=["berkeley"], now=NOW)
    assert (line["dispatched"], line["left_for_next_run"]) == (1, 1)
    sent.clear()
    pull.run(schools=["berkeley"], now=NOW + timedelta(hours=2))
    assert [body["client_payload"]["sender"] for body in sent] == ["Two"]


def test_a_failed_dispatch_is_tried_again_next_run(monkeypatch):
    attempts: list[str] = []

    def refuse(body):
        attempts.append(body["client_payload"]["sender"])
        raise pull.DispatchError("HTTP 502")

    monkeypatch.setattr(pull, "dispatch", refuse)
    _inbox(monkeypatch, [_thread("One"), _thread("Two")])
    [line] = pull.run(schools=["berkeley"], now=NOW)
    assert (line["dispatched"], line["dispatch_failed"]) == (0, 2)
    pull.run(schools=["berkeley"], now=NOW + timedelta(minutes=5))
    assert attempts == ["One", "One"]


def test_a_challenge_stops_the_run(monkeypatch, sent):
    def challenged(school, account):
        raise pull.Challenged(school)

    monkeypatch.setattr(pull, "_read", challenged)
    lines = {line["school"]: line for line in pull.run(now=NOW)}
    assert lines["berkeley"]["outcome"] == "challenge"
    assert lines["mit"] == {
        "school": "mit",
        "silent_hours": None,
        "outcome": "skipped",
        "why": "the run stopped at a challenge",
    }
    assert sent == []


def test_a_failed_read_moves_on_to_the_next_account(monkeypatch, sent):
    calls: list[str] = []

    def flaky(school, account):
        calls.append(school)
        if school == "berkeley":
            raise pull.EmulatorError("Instagram did not switch to the account")
        return [_thread("Club")], []

    monkeypatch.setattr(pull, "_read", flaky)
    lines = {line["school"]: line for line in pull.run(now=NOW)}
    assert calls == ["berkeley", "mit"]
    assert lines["berkeley"]["outcome"] == "failed"
    assert lines["berkeley"]["why"] == "EmulatorError"
    assert len(sent) == 1


def test_a_move_runs_under_this_process_hold_and_its_error_fails_the_read(monkeypatch):
    calls: list[dict] = []

    def fake_run(command, **kwargs):
        calls.append({"command": command, "env": kwargs["env"]})
        move = command[-1]
        if move == "comments":
            return subprocess.CompletedProcess(command, 1, '{"error": "no post"}\n', "")
        return subprocess.CompletedProcess(command, 0, '{"threads": []}\n', "")

    monkeypatch.setattr(pull.subprocess, "run", fake_run)
    assert pull._move("mit", "inbox") == {"threads": []}
    assert calls[0]["command"][-3:] == ["-m", "services.instagram_sessions.moves", "inbox"]
    assert calls[0]["env"]["WAT2DO_SITTING_SCHOOL"] == "mit"
    assert calls[0]["env"]["WAT2DO_EMULATOR_HELD"] == "1"
    with pytest.raises(pull.MoveFailed):
        pull._move("mit", "comments")


def test_comments_that_cannot_be_read_never_hide_the_dms(monkeypatch, sent):
    class Device:
        def __init__(self):
            pass

        def wake(self):
            pass

        def use_android_user(self, user):
            pass

        def use_account(self, user, account):
            pass

        def release_screen(self):
            pass

        def challenge(self):
            return None

    def move(school, name):
        if name == "comments":
            raise pull.MoveFailed("ig comments failed (exit 1)")
        return {"threads": [_thread("Berkeley Chess Club")]}

    monkeypatch.setattr(pull, "EmulatorDevice", Device)
    monkeypatch.setattr(pull, "exclusive", contextlib.nullcontext)
    monkeypatch.setattr(pull.notification, "waiting_for_emulator", contextlib.nullcontext)
    monkeypatch.setattr(pull, "_move", move)
    [line] = pull.run(schools=["berkeley"], now=NOW)
    assert line["outcome"] == "read" and line["comments"] is None
    assert [body["client_payload"]["sender"] for body in sent] == ["Berkeley Chess Club"]
