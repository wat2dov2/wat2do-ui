import json
import subprocess
import sys

import pytest

from services.instagram_emulator import notification_reader as module

READY = module.READY.decode().strip()
POST = {
    module.PUSH_CATEGORY: "post",
    module.PUSH_ID: "65fc29b1e2462H11beb7f373H65fc2e4b42734H49",
    module.RECIPIENT_ID: "76214170483",
    "android.title": "Waterloo Warriors Ringette",
    "android.infoText": None,
    "android.showWhen": True,
    "android.progress": 0,
}

# Stands in for the device-side reader: ready, one notification and a stray line, then
# quiet until its input closes.
LISTENING = f"""
import sys
print({READY!r}, flush=True)
print({json.dumps(POST)!r}, flush=True)
print("[1, 2]", flush=True)
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
        categories=("post", "subscription_daily_digest"),
        timeout_seconds=timeout_seconds,
        popen=popen,
    )
    return reader, started, adb_calls


def test_the_reader_runs_as_root_and_prints_only_the_categories_it_is_given():
    reader, started, adb_calls = _reader(LISTENING)
    try:
        reader.start()
        command = started[0][-1]
        assert command.startswith("su 0 sh -c ")
        assert (
            "io.wat2do.NotificationReader com.instagram.android post subscription_daily_digest"
            in command
        )
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
    assert [notification.extras for notification in notifications] == [POST]
    notification = notifications[0]
    assert notification.category == "post"
    assert notification.push_id == POST[module.PUSH_ID]
    assert notification.recipient_id == "76214170483"
    # A line that is not a notification is skipped, and never quoted.
    assert "not a notification" in caplog.text and "[1, 2]" not in caplog.text


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


def test_a_notification_without_instagram_routing_has_empty_fields():
    notification = module.Notification({module.PUSH_ID: None, "android.title": "x"})
    assert notification.category == notification.push_id == notification.recipient_id == ""
