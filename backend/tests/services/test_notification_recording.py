import json
from datetime import datetime, timedelta

import pytest

from services import notification_recording as module
from services.instagram_emulator.notification_reader import (
    PUSH_CATEGORY,
    PUSH_ID,
    RECIPIENT_ID,
    Notification,
    NotificationReaderError,
)

NOW = datetime(2026, 11, 10, 14, 3, 22).astimezone()
RECIPIENT = "76214170483"
SECRET = "meet me at 5, my number is 519 555 0199"


def _notification(category="post", push_id="push-1", **changes):
    extras = {
        PUSH_CATEGORY: category,
        PUSH_ID: push_id,
        RECIPIENT_ID: RECIPIENT,
        "android.title": "Waterloo Warriors Ringette",
        "android.text": "posted a photo",
        "android.subText": "wat2do.uwaterloo",
        "android.template": "android.app.Notification$BigPictureStyle",
        "android.showWhen": True,
    }
    extras.update(changes.pop("extras", {}))
    fields = {
        "android_user": 10,
        "key": "10|com.instagram.android|64278|newstab|10207",
        "posted_at": int(NOW.timestamp() * 1000) - 1500,
        "channel": "ig_first_posts_and_stories",
        "android_category": "",
        "group_summary": False,
        "extras": extras,
    }
    fields.update(changes)
    return Notification(**fields)


def _direct_message(**changes):
    extras = {
        "android.title": "a.student",
        "android.text": SECRET,
        "android.conversationTitle": "a.student",
        "android.isGroupConversation": False,
        "android.template": "android.app.Notification$MessagingStyle",
        "android.subText": None,
        "com.instagram.android.igns.logging.sender_id": "5550001",
        "com.instagram.android.igns.logging.ig_action": "direct_v2?id=340282366841710301244",
    }
    extras.update(changes.pop("extras", {}))
    fields = {"category": "direct_v2_text", "channel": "ig_direct", "extras": extras}
    fields.update(changes)
    return _notification(**fields)


class _Clock:
    def __init__(self):
        self.now = NOW

    def __call__(self):
        return self.now


def _lines(directory, name=module.FILE_NAME):
    return [json.loads(line) for line in (directory / name).read_text().splitlines()]


def test_a_notification_is_written_with_everything_it_carries(tmp_path):
    notifications = module.NotificationLog(tmp_path, now=_Clock())
    post = _notification()
    assert notifications.record(post)
    [line] = _lines(tmp_path)
    assert line == {
        "recorded_at": NOW.isoformat(timespec="seconds"),
        "posted_at": (NOW - timedelta(seconds=1.5)).isoformat(timespec="seconds"),
        "android_user": 10,
        "recipient_id": RECIPIENT,
        "account": "wat2do.uwaterloo",
        "category": "post",
        "channel": "ig_first_posts_and_stories",
        "extras": post.extras,
    }
    # The file and its folder are the Mac user's alone.
    assert (tmp_path / module.FILE_NAME).stat().st_mode & 0o777 == 0o600


@pytest.mark.parametrize(
    "direct_message",
    [
        _direct_message(),
        # Each sign alone marks a direct message.
        _direct_message(channel="ig_other", extras={"android.template": None}),
        _direct_message(category="unseen_direct_message_reminder", channel=""),
        _notification(category="", push_id="", channel="ig_direct"),
        _notification(category="", push_id="", channel="", android_category="msg"),
        _notification(
            category="new_kind",
            channel="ig_other",
            extras={"android.template": "android.app.Notification$MessagingStyle"},
        ),
        _notification(
            category="new_kind", channel="ig_other", extras={"android.isGroupConversation": True}
        ),
    ],
)
def test_a_direct_message_keeps_no_text(tmp_path, direct_message):
    notifications = module.NotificationLog(tmp_path, now=_Clock())
    notifications.record(_notification(push_id="taught-the-account"))
    assert notifications.record(direct_message)
    line = _lines(tmp_path)[-1]
    assert set(line) == {
        "recorded_at",
        "posted_at",
        "android_user",
        "recipient_id",
        "account",
        "category",
        "direct_message",
    }
    assert line["direct_message"] is True
    assert line["recipient_id"] == RECIPIENT
    # The account comes from an earlier notification that named it, not from the message.
    assert line["account"] == "wat2do.uwaterloo"
    written = "".join(path.read_text() for path in tmp_path.iterdir() if path.is_file())
    for secret in (SECRET, "a.student", "5550001", "340282366841710301244", direct_message.key):
        assert secret not in written


def test_a_direct_message_never_teaches_an_account(tmp_path):
    notifications = module.NotificationLog(tmp_path, now=_Clock())
    notifications.record(_direct_message(extras={"android.subText": "wat2do.uwaterloo"}))
    assert _lines(tmp_path)[0]["account"] is None


def test_a_notification_is_written_once_however_often_the_reader_replays_it(tmp_path):
    clock = _Clock()
    notifications = module.NotificationLog(tmp_path, now=clock)
    post = _notification()
    assert notifications.record(post)
    assert not notifications.record(post)
    # A restarted recorder remembers it too.
    restarted = module.NotificationLog(tmp_path, now=clock)
    assert not restarted.record(post)
    assert not restarted.record(_notification(posted_at=post.posted_at + 60_000))
    assert len(_lines(tmp_path)) == 1
    # A notification no push started counts by Android's key and post time.
    local = _notification(category="", push_id="")
    assert restarted.record(local)
    assert not restarted.record(local)
    assert restarted.record(_notification(category="", push_id="", posted_at=local.posted_at + 1))
    assert len(_lines(tmp_path)) == 3
    # The state names no thread or push, only hashes.
    state = (tmp_path / "state.json").read_text()
    assert "push-1" not in state and "newstab" not in state


def test_a_notification_is_forgotten_after_the_remembered_days(tmp_path):
    clock = _Clock()
    notifications = module.NotificationLog(tmp_path, now=clock)
    post = _notification()
    notifications.record(post)
    clock.now = NOW + timedelta(days=module.CONTROL.remember_days, seconds=1)
    # Another notification's save drops what is past remembering.
    notifications.record(_notification(push_id="push-2"))
    assert notifications.record(post)


def test_group_summaries_are_skipped(tmp_path):
    notifications = module.NotificationLog(tmp_path, now=_Clock())
    assert not notifications.record(_notification(category="", push_id="", group_summary=True))
    assert not (tmp_path / module.FILE_NAME).exists()


def test_the_file_is_rotated_at_its_size_keeping_the_newest_old_files(tmp_path, monkeypatch):
    monkeypatch.setattr(
        module,
        "CONTROL",
        module.CONTROL.model_copy(update={"file_max_bytes": 1000, "file_backup_count": 2}),
    )
    notifications = module.NotificationLog(tmp_path, now=_Clock())
    for number in range(8):
        notifications.record(_notification(push_id=f"push-{number}"))
    files = sorted(path.name for path in tmp_path.glob(f"{module.FILE_NAME}*"))
    assert files == [module.FILE_NAME, f"{module.FILE_NAME}.1", f"{module.FILE_NAME}.2"]
    assert all((tmp_path / name).stat().st_size <= 1000 for name in files)
    kept = [line["extras"][PUSH_ID] for name in reversed(files) for line in _lines(tmp_path, name)]
    # The oldest lines went with the dropped file; the rest stay in order.
    assert kept == [f"push-{number}" for number in range(8 - len(kept), 8)]


def test_an_unreadable_state_is_moved_aside(tmp_path, caplog):
    (tmp_path / "state.json").write_text("{not json")
    notifications = module.NotificationLog(tmp_path, now=_Clock())
    assert notifications.record(_notification())
    assert any(path.name.startswith("state.json.unreadable-") for path in tmp_path.iterdir())
    assert "unreadable" in caplog.text


class _Device:
    def __init__(self, ups):
        self.ups = list(ups)

    def is_online(self):
        return self.ups.pop(0)

    def booted(self):
        return True


class _Reader:
    """Hands out batches of notifications; None stands for the reader stopping."""

    def __init__(self, batches, *, fail_starts=0):
        self.batches = list(batches)
        self.fail_starts = fail_starts
        self.running = False
        self.starts = 0
        self.stops = 0

    def start(self):
        self.starts += 1
        if self.fail_starts:
            self.fail_starts -= 1
            raise NotificationReaderError("The notification reader did not start")
        self.running = True

    def notifications(self, seconds):
        batch = self.batches.pop(0)
        if batch is None:
            self.running = False
            raise NotificationReaderError("The notification reader stopped")
        yield from batch

    def stop(self):
        self.running = False
        self.stops += 1


class _Log:
    def __init__(self):
        self.recorded = []

    def record(self, notification):
        self.recorded.append(notification)
        return True


def _recorder(device, reader, *, clock=None):
    sleeps = []
    notifications = _Log()
    recorder = module.Recorder(
        device,
        reader,
        notifications,
        sleep=sleeps.append,
        monotonic=clock or (lambda: 0.0),
    )
    return recorder, notifications, sleeps


def test_the_recorder_waits_for_the_emulator_with_a_growing_pause_then_listens():
    device = _Device([False, False, False, True])
    post = _notification()
    reader = _Reader([[post]])
    recorder, notifications, sleeps = _recorder(device, reader)
    for _ in range(5):
        recorder.step()
    first = module.CONTROL.reconnect_first_seconds
    assert sleeps == [first, first * 2, first * 4]
    assert reader.starts == 1
    assert notifications.recorded == [post]


def test_the_recorder_listens_again_after_the_emulator_restarts():
    device = _Device([True, False, True])
    reader = _Reader([[], None, [_notification()]])
    recorder, notifications, sleeps = _recorder(device, reader)
    for _ in range(6):
        recorder.step()
    first = module.CONTROL.reconnect_first_seconds
    # Stopped, waited, found it down, waited longer, then started again.
    assert sleeps == [first, first * 2]
    assert reader.starts == 2
    assert len(notifications.recorded) == 1


def test_a_reader_that_cannot_start_is_tried_again_after_a_pause():
    reader = _Reader([[]], fail_starts=1)
    recorder, _, sleeps = _recorder(_Device([True, True]), reader)
    recorder.step()
    recorder.step()
    assert sleeps == [module.CONTROL.reconnect_first_seconds]
    assert reader.starts == 2 and reader.running


def test_the_pause_never_exceeds_the_longest():
    device = _Device([False] * 20)
    recorder, _, sleeps = _recorder(device, _Reader([]))
    for _ in range(20):
        recorder.step()
    assert max(sleeps) == module.CONTROL.reconnect_longest_seconds


def test_a_quiet_reader_is_started_again():
    clock = [0.0]
    reader = _Reader([[], []])
    recorder, _, _ = _recorder(_Device([True, True]), reader, clock=lambda: clock[0])
    recorder.step()
    recorder.step()
    assert reader.stops == 0
    clock[0] = module.CONTROL.quiet_restart_minutes * 60
    recorder.step()
    assert reader.stops == 1
    recorder.step()
    assert reader.starts == 2


class _Stop(Exception):
    pass


def test_a_failed_step_stops_the_reader_and_the_recorder_goes_on(caplog):
    class _Broken(_Log):
        def record(self, notification):
            raise OSError("No space left on device")

    sleeps = []

    def sleep(seconds):
        sleeps.append(seconds)
        # Ends run_forever once it has handled the failed step.
        raise _Stop

    reader = _Reader([[_notification()]])
    recorder = module.Recorder(
        _Device([True]), reader, _Broken(), sleep=sleep, monotonic=lambda: 0.0
    )
    recorder.step()
    with pytest.raises(_Stop):
        recorder.run_forever()
    assert reader.stops == 1
    assert sleeps == [module.CONTROL.reconnect_first_seconds]
    assert "failed a step" in caplog.text
