"""One Android emulator, read through its accessibility tree and tapped at a human pace.

Every screen is located by the labels Instagram exposes to accessibility tools, never
by fixed coordinates, and every tap lands at a random point inside its control after
a random pause, so the app sees a person's rhythm rather than a script's.
"""

from __future__ import annotations

import os
import random
import re
import shutil
import subprocess
import time
import xml.etree.ElementTree as ElementTree
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from pathlib import Path

from core.controlbox import controlbox

CONTROL = controlbox.instagram_emulator
_BOUNDS = re.compile(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]")
_DUMP_SUFFIX = "UI hierchary dumped to"
_LAUNCHER_ACTIVITY = "com.instagram.mainactivity.LauncherActivity"
_SCREEN_READ_ATTEMPTS = 5


class EmulatorError(RuntimeError):
    """The emulator or the Instagram app is not in a state the automation expects."""


@dataclass(frozen=True)
class Node:
    text: str
    description: str
    bounds: tuple[int, int, int, int]

    def labelled(self, pattern: re.Pattern[str]) -> bool:
        return bool(pattern.match(self.text) or pattern.match(self.description))


def labels(*names: str) -> re.Pattern[str]:
    """Match a control whose text or accessibility label starts with one of ``names``."""
    return re.compile("^(?:" + "|".join(re.escape(name) for name in names) + r")(?:\b|$)")


def _adb_path() -> str:
    found = shutil.which("adb")
    if found:
        return found
    sdk = Path(os.environ.get("ANDROID_HOME") or Path.home() / "Library/Android/sdk")
    return str(sdk / "platform-tools" / "adb")


class EmulatorDevice:
    def __init__(
        self,
        *,
        run: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
        sleep: Callable[[float], None] = time.sleep,
        monotonic: Callable[[], float] = time.monotonic,
        rng: random.Random | None = None,
    ) -> None:
        self._run = run
        self._sleep = sleep
        self._monotonic = monotonic
        self._rng = rng or random.SystemRandom()
        self._adb = _adb_path()

    def adb(self, *args: str) -> str:
        try:
            completed = self._run(
                [self._adb, "-s", CONTROL.serial, *args],
                capture_output=True,
                text=True,
                timeout=CONTROL.adb_timeout_seconds,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise EmulatorError(f"adb {args[0]} did not complete") from exc
        if completed.returncode != 0:
            raise EmulatorError(f"adb {args[0]} failed")
        return completed.stdout

    def screen(self) -> list[Node]:
        for attempt in range(_SCREEN_READ_ATTEMPTS):
            try:
                dump = self.adb("exec-out", "uiautomator", "dump", "/dev/tty")
                break
            except EmulatorError:
                # The dump fails while the app is still animating, such as a playing video.
                if attempt == _SCREEN_READ_ATTEMPTS - 1:
                    raise
                self._sleep(1)
        dump = dump.split(_DUMP_SUFFIX, 1)[0].strip()
        if not dump:
            return []
        try:
            root = ElementTree.fromstring(dump)
        except ElementTree.ParseError as exc:
            raise EmulatorError("Emulator screen could not be read") from exc
        nodes = []
        for element in root.iter("node"):
            match = _BOUNDS.fullmatch(element.get("bounds", ""))
            if not match:
                continue
            x1, y1, x2, y2 = (int(value) for value in match.groups())
            if x2 > x1 and y2 > y1:
                nodes.append(
                    Node(element.get("text", ""), element.get("content-desc", ""), (x1, y1, x2, y2))
                )
        return nodes

    def find(self, pattern: re.Pattern[str], nodes: Iterable[Node] | None = None) -> Node | None:
        return next(
            (
                node
                for node in (self.screen() if nodes is None else nodes)
                if node.labelled(pattern)
            ),
            None,
        )

    def wait_for(self, pattern: re.Pattern[str], *, seconds: float | None = None) -> Node:
        deadline = self._monotonic() + (seconds or CONTROL.screen_wait_seconds)
        while True:
            node = self.find(pattern)
            if node is not None:
                return node
            if self._monotonic() >= deadline:
                raise EmulatorError(f"Instagram never showed {pattern.pattern}")
            self._sleep(1)

    def wait_until_gone(self, pattern: re.Pattern[str], *, seconds: float) -> None:
        deadline = self._monotonic() + seconds
        while self.find(pattern) is not None:
            if self._monotonic() >= deadline:
                raise EmulatorError(f"Instagram kept showing {pattern.pattern}")
            self._sleep(1)

    def tap(self, node: Node, *, hold_ms: int = 0) -> None:
        self.pause()
        x1, y1, x2, y2 = node.bounds
        # Land somewhere in the middle half of the control, never on its edge.
        x = round(self._rng.uniform(x1 + (x2 - x1) / 4, x2 - (x2 - x1) / 4))
        y = round(self._rng.uniform(y1 + (y2 - y1) / 4, y2 - (y2 - y1) / 4))
        if hold_ms:
            self.adb("shell", "input", "swipe", str(x), str(y), str(x), str(y), str(hold_ms))
        else:
            self.adb("shell", "input", "tap", str(x), str(y))

    def tap_when(self, pattern: re.Pattern[str], *, seconds: float | None = None) -> None:
        self.tap(self.wait_for(pattern, seconds=seconds))

    def pause(self) -> None:
        self._sleep(
            self._rng.uniform(CONTROL.step_delay_min_seconds, CONTROL.step_delay_max_seconds)
        )

    def back(self) -> None:
        self.pause()
        self.adb("shell", "input", "keyevent", "KEYCODE_BACK")

    def wake(self) -> None:
        self.adb("shell", "input", "keyevent", "KEYCODE_WAKEUP")
        self.adb("shell", "wm", "dismiss-keyguard")

    def use_android_user(self, user: int) -> None:
        """Bring the Android user that holds the account to the foreground."""
        if self.adb("shell", "am", "get-current-user").strip() == str(user):
            return
        self.adb("shell", "am", "switch-user", str(user))
        self._sleep(CONTROL.user_switch_wait_seconds)
        self.wake()
        if self.adb("shell", "am", "get-current-user").strip() != str(user):
            raise EmulatorError("Emulator did not switch Android users")

    def open_instagram(self, user: int, url: str | None = None) -> None:
        if url is None:
            target = ["-n", f"{CONTROL.instagram_package}/{_LAUNCHER_ACTIVITY}"]
        else:
            target = ["-a", "android.intent.action.VIEW", "-d", url, CONTROL.instagram_package]
        self.adb("shell", "am", "start", "--user", str(user), *target)
