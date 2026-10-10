import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

from scripts import automate_bell_notifications as script


@pytest.fixture(autouse=True)
def no_device_commands(monkeypatch):
    monkeypatch.setattr(script.time, "sleep", lambda _seconds: None)
    monkeypatch.setattr(
        script.subprocess,
        "run",
        lambda *_args, **_kwargs: pytest.fail("tests must never issue ADB commands"),
    )


def _sheet(status):
    return ET.fromstring(
        '<hierarchy><node><node><node text="Posts" bounds="[1,1][9,9]"/>'
        '<node resource-id="com.instagram.android:id/context_menu_item_sub_label" '
        f'text="{status}"/></node></node></hierarchy>'
    )


def test_adb_command_deadline_and_error_do_not_expose_device_output(monkeypatch):
    def timeout(command, **kwargs):
        assert kwargs["timeout"] == script.CONTROL.command_timeout_seconds
        raise subprocess.TimeoutExpired(command, kwargs["timeout"], output="private notification")

    monkeypatch.setattr(script.subprocess, "run", timeout)
    with pytest.raises(script.BellSetupError, match="TimeoutExpired") as failure:
        script.run_cmd([script.ADB_PATH, "devices"])
    assert "private notification" not in str(failure.value)


def test_dump_uses_private_temporary_paths_and_removes_them(monkeypatch):
    destinations = []

    def command(arguments, **_kwargs):
        if arguments[1] == "pull":
            path = Path(arguments[-1])
            destinations.append(path)
            path.write_text("<hierarchy><node text='Posts'/></hierarchy>")
        return ""

    monkeypatch.setattr(script, "run_cmd", command)
    assert script.dump_ui() is not None
    assert script.dump_ui() is not None
    assert destinations[0] != destinations[1]
    assert all(not path.parent.exists() for path in destinations)


def test_repeated_dump_failure_stops_with_actionable_failure(monkeypatch):
    calls = []
    monkeypatch.setattr(script, "dump_ui", lambda: calls.append(1) or None)
    with pytest.raises(script.BellSetupError, match="UI remained unavailable"):
        script.run()
    assert len(calls) == script.CONTROL.max_consecutive_dump_failures


def test_run_counts_only_confirmed_accounts_and_does_not_replay_failed_taps(monkeypatch, capsys):
    root = ET.fromstring("<hierarchy/>")
    monkeypatch.setattr(script, "dump_ui", lambda: root)
    monkeypatch.setattr(
        script,
        "consolidated_rows",
        lambda _root: [("good.account", (800, 900)), ("uncertain.account", (800, 1100))],
    )
    attempts = []

    def set_all(position):
        attempts.append(position)
        return position[1] == 900

    monkeypatch.setattr(script, "set_all_for_bell", set_all)
    monkeypatch.setattr(script, "scroll_down", lambda: None)
    result = script.run()
    assert result == {"confirmed": 1, "failed": 1}
    assert attempts == [(800, 900), (800, 1100)]
    assert "1 failed or unconfirmed" in capsys.readouterr().out


@pytest.mark.parametrize("confirmed_status,expected", [("All", True), ("Off", False)])
def test_menu_disappearance_requires_a_fresh_posts_all_confirmation(
    monkeypatch, confirmed_status, expected
):
    sheets = iter(
        [
            _sheet("Off"),
            ET.fromstring('<hierarchy><node text="All" bounds="[1,1][9,9]"/></hierarchy>'),
            *[_sheet(confirmed_status)] * (script.CONTROL.verification_retry_limit + 1),
        ]
    )
    monkeypatch.setattr(script, "wait_for", lambda *_args, **_kwargs: next(sheets))
    monkeypatch.setattr(script, "dump_ui", lambda: ET.fromstring("<hierarchy/>"))
    monkeypatch.setattr(script, "press_back", lambda: None)
    taps = []
    monkeypatch.setattr(script, "tap", lambda *position: taps.append(position))
    assert script.set_all_for_bell((800, 900)) is expected
    assert taps == [(800, 900), (5, 5), (5, 5), (800, 900)]


def test_wrong_screen_fails_before_scrolling_or_tapping(monkeypatch):
    monkeypatch.setattr(script, "dump_ui", lambda: ET.fromstring("<hierarchy/>"))
    monkeypatch.setattr(
        script, "scroll_down", lambda: pytest.fail("must not alter the wrong screen")
    )
    with pytest.raises(script.BellSetupError, match="No following rows"):
        script.run()


def test_multiple_devices_require_an_explicit_target(monkeypatch, tmp_path):
    adb = tmp_path / "adb"
    adb.touch()
    monkeypatch.setattr(script, "ADB_PATH", str(adb))
    monkeypatch.setattr(
        script,
        "run_cmd",
        lambda *_args: "List of devices attached\nR5CT1234567\tdevice\nR5CT7654321\tdevice",
    )
    with pytest.raises(script.BellSetupError, match="Multiple devices"):
        script.main([])


def test_main_returns_nonzero_when_any_account_is_unconfirmed(monkeypatch, tmp_path):
    adb = tmp_path / "adb"
    adb.touch()
    monkeypatch.setattr(script, "ADB_PATH", str(adb))
    monkeypatch.setattr(
        script, "run_cmd", lambda *_args: "List of devices attached\nR5CT1234567\tdevice"
    )
    monkeypatch.setattr(script, "disable_animations", lambda: None)
    monkeypatch.setattr(script, "state_directory_path", lambda: tmp_path / "state")
    monkeypatch.setattr(script, "run", lambda: {"confirmed": 1, "failed": 1})
    assert script.main([]) == 1
