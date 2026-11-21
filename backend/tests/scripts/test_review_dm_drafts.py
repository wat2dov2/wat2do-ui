"""Opening a school's inbox on the emulator's screen to review its unsent drafts."""

import sys
from contextlib import nullcontext

from scripts import review_dm_drafts as script


class _Device:
    steps: list[tuple] = []

    def wake(self):
        _Device.steps.append(("wake",))

    def use_android_user(self, user):
        _Device.steps.append(("user", user))

    def use_account(self, user, account):
        _Device.steps.append(("account", account))

    def open_inbox(self, user):
        _Device.steps.append(("inbox", user))

    def release_screen(self):
        _Device.steps.append(("release",))


def test_without_the_viewer_it_says_how_to_install_it(monkeypatch, capsys):
    monkeypatch.setattr(sys, "argv", ["review", "tmu"])
    monkeypatch.setattr(script.shutil, "which", lambda name: None)
    assert script.main() == 1
    assert "brew install scrcpy" in capsys.readouterr().out


def test_the_inbox_opens_on_the_schools_account_while_the_emulator_is_held(monkeypatch):
    _Device.steps = []
    held = []
    monkeypatch.setattr(sys, "argv", ["review", "tmu"])
    monkeypatch.setattr(script.shutil, "which", lambda name: "/opt/homebrew/bin/scrcpy")
    monkeypatch.setattr(script, "EmulatorDevice", _Device)
    monkeypatch.setattr(script, "exclusive", lambda: held.append(True) or nullcontext())
    shown = []
    monkeypatch.setattr(script.subprocess, "run", lambda args, **_: shown.append(args))
    assert script.main() == 0
    user = script.CONTROL.android_user_by_school["tmu"]
    assert _Device.steps == [
        ("wake",),
        ("user", user),
        ("account", "wat2do.tmu"),
        ("inbox", user),
        ("release",),
    ]
    assert held == [True]
    assert shown[0][:3] == ["/opt/homebrew/bin/scrcpy", "--serial", script.CONTROL.serial]
