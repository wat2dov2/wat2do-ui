import json
import subprocess

import pytest

from services import notification_dispatch as module
from services.instagram_emulator.notification_reader import (
    PUSH_CATEGORY,
    PUSH_ID,
    RECIPIENT_ID,
    Notification,
)

RECIPIENT = "76214170483"


def _notification(category="post", push_id="push-1", recipient=RECIPIENT):
    extras = {
        PUSH_CATEGORY: category,
        PUSH_ID: push_id,
        RECIPIENT_ID: recipient,
        "android.text": "posted",
    }
    return Notification(
        android_user=10,
        key="10|com.instagram.android|1|newstab|2",
        posted_at=1_762_800_000_000,
        channel="ig_first_posts_and_stories",
        android_category="",
        group_summary=False,
        extras=extras,
    )


class _Clock:
    def __init__(self):
        self.now = 0.0
        self.slept = []

    def monotonic(self):
        return self.now

    def sleep(self, seconds):
        self.slept.append(seconds)
        self.now += seconds


def _dispatcher(tmp_path, send, clock=None):
    clock = clock or _Clock()
    return (
        module.Dispatcher(
            tmp_path / "dispatch.json",
            send=send,
            now=lambda: 1_762_800_000.0,
            sleep=clock.sleep,
            monotonic=clock.monotonic,
        ),
        clock,
    )


def test_only_what_the_workflow_takes_is_queued(tmp_path):
    dispatcher, _ = _dispatcher(tmp_path, send=lambda extras: None)
    assert dispatcher.offer(_notification("post"))
    assert dispatcher.offer(_notification("subscription_daily_digest", push_id="push-2"))
    assert not dispatcher.offer(_notification("direct_v2_text", push_id="push-3"))
    assert not dispatcher.offer(_notification("like", push_id="push-4"))
    assert not dispatcher.offer(_notification(push_id=""))
    assert not dispatcher.offer(_notification(recipient=""))
    assert len(dispatcher) == 2


def test_each_notification_is_sent_once_with_its_extras(tmp_path):
    sent = []
    dispatcher, _ = _dispatcher(tmp_path, send=sent.append)
    post = _notification()
    dispatcher.offer(post)
    dispatcher.send_due()
    assert sent == [post.extras]
    assert not dispatcher.offer(post)
    # Remembered across a restart too.
    again, _ = _dispatcher(tmp_path, send=sent.append)
    assert not again.offer(post)
    again.send_due()
    assert len(sent) == 1


def test_a_failed_dispatch_waits_and_is_tried_again_after_a_growing_pause(tmp_path):
    outcomes = [module.DispatchError("HTTP 502"), module.DispatchError("HTTP 502"), None]
    sent = []

    def send(extras):
        outcome = outcomes.pop(0)
        if outcome:
            raise outcome
        sent.append(extras)

    dispatcher, clock = _dispatcher(tmp_path, send)
    dispatcher.offer(_notification())
    dispatcher.send_due()
    assert len(dispatcher) == 1
    dispatcher.send_due()  # still pausing
    assert outcomes and len(outcomes) == 2
    clock.now += module.CONTROL.retry_first_seconds
    dispatcher.send_due()
    assert len(dispatcher) == 1
    clock.now += module.CONTROL.retry_first_seconds  # the pause doubled
    dispatcher.send_due()
    assert len(dispatcher) == 1
    clock.now += module.CONTROL.retry_first_seconds
    dispatcher.send_due()
    assert len(dispatcher) == 0 and len(sent) == 1
    # It survives a restart while waiting.
    assert json.loads((tmp_path / "dispatch.json").read_text())["waiting"] == []


def test_a_notification_github_keeps_refusing_is_dropped(tmp_path, caplog):
    def send(extras):
        raise module.DispatchRefused("HTTP 422")

    dispatcher, clock = _dispatcher(tmp_path, send)
    dispatcher.offer(_notification())
    for _ in range(module.CONTROL.refusals_before_drop):
        clock.now += module.CONTROL.retry_longest_seconds
        dispatcher.send_due()
    assert len(dispatcher) == 0
    assert "dropped it" in caplog.text
    assert "posted" not in caplog.text


def test_dispatches_are_spaced_out(tmp_path):
    dispatcher, clock = _dispatcher(tmp_path, send=lambda extras: None)
    for n in range(3):
        dispatcher.offer(_notification(push_id=f"push-{n}"))
    dispatcher.send_due()
    assert clock.slept == [module.CONTROL.send_spacing_seconds] * 2


def test_an_unreadable_queue_is_moved_aside(tmp_path, caplog):
    (tmp_path / "dispatch.json").write_text("{not json")
    dispatcher, _ = _dispatcher(tmp_path, send=lambda extras: None)
    assert len(dispatcher) == 0
    assert list(tmp_path.glob("dispatch.json.unreadable-*"))


def test_dispatch_sends_the_phones_payload_through_gh(monkeypatch):
    calls = []

    def run(args, **kwargs):
        calls.append((args, kwargs))
        return subprocess.CompletedProcess(args, 0, "", "")

    monkeypatch.setattr(module.subprocess, "run", run)
    module.dispatch({"a": 1})
    args, kwargs = calls[0]
    assert args[:3] == ["gh", "api", f"repos/{module.CONTROL.github_repo}/dispatches"]
    assert json.loads(kwargs["input"]) == {
        "event_type": "new_instagram_post",
        "client_payload": {"notification_dict": {"a": 1}},
    }


@pytest.mark.parametrize(
    ("stderr", "error"),
    [
        ("gh: Validation Failed (HTTP 422)", module.DispatchRefused),
        ("gh: Server Error (HTTP 502)", module.DispatchError),
        ("error connecting to api.github.com", module.DispatchError),
    ],
)
def test_dispatch_failures_are_told_apart(monkeypatch, stderr, error):
    monkeypatch.setattr(
        module.subprocess,
        "run",
        lambda args, **kwargs: subprocess.CompletedProcess(args, 1, "", stderr),
    )
    with pytest.raises(error):
        module.dispatch({})
