import subprocess
import sys

import pytest

from services.instagram_emulator import screen_reader as module
from services.instagram_emulator.device_program import SCREEN_READER

SCREEN = '<?xml version="1.0" ?><hierarchy rotation="0"><node text="Edit" bounds="[0,0][9,9]" /></hierarchy>'
END = module.END.decode()

# Stands in for the device-side reader: ready line first, then one screen per request.
SERVING = f"""
import sys
print({END!r}, flush=True)
for line in sys.stdin:
    print({SCREEN!r}, flush=True)
    print({END!r}, flush=True)
"""
# Connects, answers one request, then dies.
DYING = f"""
import sys
print({END!r}, flush=True)
sys.stdin.readline()
"""
# Connects, then never answers.
SILENT = f"""
import sys, time
print({END!r}, flush=True)
sys.stdin.readline()
time.sleep(30)
"""


def _reader(*scripts, timeout_seconds=10.0):
    started = []
    adb_calls = []

    def popen(command, **kwargs):
        started.append(command)
        script = scripts[min(len(started), len(scripts)) - 1]
        return subprocess.Popen([sys.executable, "-c", script], **kwargs)

    def adb(*args):
        adb_calls.append(args)
        return ""

    reader = module.ScreenReader(
        "adb",
        "emulator-5554",
        adb,
        settle_milliseconds=1000,
        settle_wait_seconds=5,
        timeout_seconds=timeout_seconds,
        popen=popen,
    )
    return reader, started, adb_calls


def test_one_reader_answers_every_read_until_it_is_stopped():
    reader, started, adb_calls = _reader(SERVING)
    try:
        assert reader.read() == SCREEN
        assert reader.read() == SCREEN
        assert len(started) == 1
        command = started[0][-1]
        assert "app_process" in command and "io.wat2do.ScreenReader 1000 5000" in command
        # A reader left behind is ended, then the jar is copied before the reader starts.
        assert adb_calls == [
            ("shell", "pkill", "-f", SCREEN_READER.process_name),
            ("push", str(SCREEN_READER.jar), SCREEN_READER.remote_jar),
        ]
    finally:
        reader.stop()
    assert not reader.running


def test_a_reader_that_dies_fails_the_read_and_the_next_read_starts_another():
    reader, started, _ = _reader(DYING, SERVING)
    try:
        with pytest.raises(module.ScreenReaderError):
            reader.read()
        assert reader.read() == SCREEN
        assert len(started) == 2
    finally:
        reader.stop()


def test_a_reader_that_stops_answering_fails_the_read_in_time():
    reader, _, _ = _reader(SILENT, timeout_seconds=0.5)
    try:
        with pytest.raises(module.ScreenReaderError):
            reader.read()
        assert not reader.running
    finally:
        reader.stop()
