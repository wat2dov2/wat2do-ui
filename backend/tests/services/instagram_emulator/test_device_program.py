import subprocess
import sys
import zipfile

import pytest

from services.instagram_emulator import device_program as module

# Stands in for a device-side program: prints a line, then echoes each input line.
ECHOING = """
import sys
print("hello", flush=True)
for line in sys.stdin:
    print(line.strip(), flush=True)
"""
# Prints a line, then ends.
ENDING = """
print("bye", flush=True)
"""


def _process(script, *, root=False, class_path=()):
    started = []
    adb_calls = []

    def popen(command, **kwargs):
        started.append(command)
        return subprocess.Popen([sys.executable, "-c", script], **kwargs)

    def adb(*args):
        adb_calls.append(args)
        return ""

    process = module.DeviceProcess(
        module.NOTIFICATION_READER,
        "adb",
        "emulator-5554",
        adb,
        root=root,
        class_path=class_path,
        popen=popen,
    )
    return process, started, adb_calls


@pytest.mark.parametrize("program", module.PROGRAMS, ids=lambda program: program.name)
def test_every_committed_jar_is_built_from_its_current_source(program):
    with zipfile.ZipFile(program.jar) as jar:
        assert "classes.dex" in jar.namelist()
    # Rebuild with scripts/build_emulator_jars.py after changing the Java source.
    assert program.built_hash() == program.source_hash()


def test_a_program_runs_from_its_jar_under_app_process():
    process, started, adb_calls = _process(ECHOING, class_path=("/system/framework/x.jar",))
    try:
        process.start("1", "two words")
        command = started[0][-1]
        assert started[0][:5] == ["adb", "-s", "emulator-5554", "shell", "-T"]
        assert command == (
            "CLASSPATH=/data/local/tmp/wat2do-notification-reader.jar:/system/framework/x.jar "
            "exec app_process / --nice-name=wat2do-notification-reader "
            "io.wat2do.NotificationReader 1 'two words'"
        )
        # A copy left behind is ended, then the jar is copied before the program starts.
        assert adb_calls == [
            ("shell", "pkill", "-f", "wat2do-notification-reader"),
            ("push", str(module.NOTIFICATION_READER.jar), module.NOTIFICATION_READER.remote_jar),
        ]
        assert process.read_until(b"\n", 10) == b"hello"
        process.write(b"again\n")
        assert process.read_until(b"\n", 10) == b"again"
    finally:
        process.stop()
    assert not process.running


def test_a_root_program_starts_and_is_ended_as_root():
    process, started, adb_calls = _process(ECHOING, root=True)
    try:
        process.start("post")
        assert started[0][-1].startswith("su 0 sh -c 'CLASSPATH=")
        assert adb_calls[0] == ("shell", "su", "0", "pkill", "-f", "wat2do-notification-reader")
    finally:
        process.stop()


def test_a_marker_that_does_not_come_in_time_reads_nothing():
    process, _, _ = _process(ECHOING)
    try:
        process.start()
        assert process.read_until(b"\n", 10) == b"hello"
        assert process.read_until(b"\n", 0.2) is None
        assert process.running
    finally:
        process.stop()


def test_reading_from_a_program_that_ended_raises():
    process, _, _ = _process(ENDING)
    try:
        process.start()
        assert process.read_until(b"\n", 10) == b"bye"
        with pytest.raises(module.DeviceProgramStopped):
            process.read_until(b"\n", 10)
    finally:
        process.stop()


def test_a_program_that_is_not_running_takes_no_input():
    process, _, _ = _process(ECHOING)
    with pytest.raises(module.DeviceProgramStopped):
        process.write(b"\n")
    with pytest.raises(module.DeviceProgramStopped):
        process.read_until(b"\n", 1)
