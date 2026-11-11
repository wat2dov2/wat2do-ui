import json
import subprocess
import sys

import pytest

from services.instagram_emulator import notification_reader as module

READY = module.READY.decode().strip()
POST = {
    "user": 10,
    "key": "10|com.instagram.android|64278|newstab|10207",
    "posted_at": 1762800000123,
    "channel": "ig_first_posts_and_stories",
    "category": None,
    "group_summary": False,
    "extras": {
        module.PUSH_CATEGORY: "post",
        module.PUSH_ID: "65fc29b1e2462H11beb7f373H65fc2e4b42734H49",
        module.RECIPIENT_ID: "76214170483",
        "android.title": "Waterloo Warriors Ringette",
        "android.infoText": None,
        "android.showWhen": True,
    },
}

# Stands in for the device-side reader: ready, one notification and two stray lines, then
# quiet until its input closes.
LISTENING = f"""
import sys
print({READY!r}, flush=True)
print({json.dumps(POST)!r}, flush=True)
print("[1, 2]", flush=True)
print({json.dumps({**POST, "user": "ten"})!r}, flush=True)
sys.stdin.read()
"""
# Ready, then the device goes away.
ENDING = f"""
print({READY!r}, flush=True)
"""
# Never connects.
SILENT = """
import sys
sys.stdin.read()
"""


def _reader(script, *, timeout_seconds=10.0):
    started = []
    adb_calls = []

    def popen(command, **kwargs):
        started.append(command)
        return subprocess.Popen([sys.executable, "-c", script], **kwargs)

    def adb(*args):
        adb_calls.append(args)
        return ""

    reader = module.NotificationReader(
        "adb",
        "emulator-5554",
        adb,
        package="com.instagram.android",
        timeout_seconds=timeout_seconds,
        popen=popen,
    )
    return reader, started, adb_calls


def test_the_reader_runs_as_root_for_every_notification_of_the_app():
    reader, started, adb_calls = _reader(LISTENING)
    try:
        reader.start()
        command = started[0][-1]
        assert command.startswith("su 0 sh -c ")
        assert command.endswith("io.wat2do.NotificationReader com.instagram.android'")
        # A reader left running as root is ended as root before the jar is copied.
        assert adb_calls[0] == ("shell", "su", "0", "pkill", "-f", "wat2do-notification-reader")
        assert adb_calls[1][0] == "push"
    finally:
        reader.stop()
    assert not reader.running


def test_notifications_are_read_as_they_are_printed_until_the_time_is_up(caplog):
    reader, _, _ = _reader(LISTENING)
    try:
        reader.start()
        notifications = list(reader.notifications(1))
    finally:
        reader.stop()
    [notification] = notifications
    assert notification == module.Notification(
        android_user=10,
        key=POST["key"],
        posted_at=1762800000123,
        channel="ig_first_posts_and_stories",
        android_category="",
        group_summary=False,
        extras=POST["extras"],
    )
    assert notification.category == "post"
    assert notification.push_id == POST["extras"][module.PUSH_ID]
    assert notification.recipient_id == "76214170483"
    # Lines that are not notifications are skipped, and never quoted.
    assert caplog.text.count("not a notification") == 2
    assert "[1, 2]" not in caplog.text and "ten" not in caplog.text


def test_a_notification_never_quotes_its_extras():
    notification = module.Notification.parse(json.dumps(POST).encode())
    assert notification is not None
    assert "Ringette" not in repr(notification)


def test_a_reader_whose_device_goes_away_stops():
    reader, _, _ = _reader(ENDING)
    reader.start()
    with pytest.raises(module.NotificationReaderError, match="stopped"):
        list(reader.notifications(10))
    assert not reader.running


def test_a_reader_that_never_connects_fails_to_start_in_time():
    reader, _, _ = _reader(SILENT, timeout_seconds=0.5)
    with pytest.raises(module.NotificationReaderError, match="did not start"):
        reader.start()
    assert not reader.running


def test_a_notification_no_push_started_has_empty_instagram_fields():
    notification = module.Notification.parse(
        json.dumps({**POST, "extras": {module.PUSH_ID: None, "android.title": "x"}}).encode()
    )
    assert notification is not None
    assert notification.category == notification.push_id == notification.recipient_id == ""
