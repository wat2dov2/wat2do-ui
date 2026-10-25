"""One Android emulator, read through its accessibility tree and tapped at a human pace.

Every screen is located by the labels Instagram exposes to accessibility tools, never
by fixed coordinates, and every tap lands at a random point inside its control after
a random pause, so the app sees a person's rhythm rather than a script's.
"""

from __future__ import annotations

import fcntl
import os
import random
import re
import shlex
import shutil
import subprocess
import threading
import time
import xml.etree.ElementTree as ElementTree
from collections.abc import Callable, Iterable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

from core.controlbox import controlbox

CONTROL = controlbox.instagram_emulator
_BOUNDS = re.compile(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]")
_DUMP_SUFFIX = "UI hierchary dumped to"
_LAUNCHER_ACTIVITY = "com.instagram.mainactivity.LauncherActivity"
_SCREEN_READ_ATTEMPTS = 5
# Every job that drives the emulator holds this lock, so two never tap at once.
_LOCK_PATH = Path.home() / ".local/state/wat2do/instagram-emulator.lock"
# Touched after each reclaim; Google Play services rebuilds its data, so clearing it
# on every visit only keeps the disk busy.
_RECLAIMED_PATH = Path.home() / ".local/state/wat2do/instagram-emulator-reclaimed"
_held = threading.local()
_SELECT_ALL = ("113", "29")  # KEYCODE_CTRL_LEFT + KEYCODE_A


class EmulatorError(RuntimeError):
    """The emulator or the Instagram app is not in a state the automation expects."""


@dataclass(frozen=True)
class Node:
    text: str
    description: str
    bounds: tuple[int, int, int, int]
    # The app's own name for the view, for the few controls Instagram leaves unlabelled.
    resource_id: str = ""

    @property
    def label(self) -> str:
        return self.text or self.description

    def inside(self, outer: Node) -> bool:
        x1, y1, x2, y2 = self.bounds
        ox1, oy1, ox2, oy2 = outer.bounds
        return ox1 <= x1 and oy1 <= y1 and x2 <= ox2 and y2 <= oy2

    def labelled(self, pattern: re.Pattern[str]) -> bool:
        return bool(
            pattern.match(self.text)
            or pattern.match(self.description)
            or (self.resource_id and pattern.match(self.resource_id))
        )


def labels(*names: str) -> re.Pattern[str]:
    """Match a control whose text or accessibility label starts with one of ``names``."""
    return re.compile("^(?:" + "|".join(re.escape(name) for name in names) + r")(?:\b|$)")


INBOX_URL = "instagram://direct-inbox"
_INBOX_TITLE = re.compile(r"^igds_action_bar_title$")
_MESSAGES_TAB = re.compile(r"^direct_tab$")
_PROFILE_TAB = re.compile(r"^Profile$")
_SAVE_LOGIN = labels("Save your login info")
_SAVE = re.compile(r"^Save$")
_NOT_NOW = re.compile(r"^Not now$")
_LOW_STORAGE = labels("Low device storage")
# Android's own dialog when the app freezes for a few seconds on a busy emulator.
_NOT_RESPONDING = re.compile(r"^.+ isn't responding$")
_WAIT = labels("Wait")
_CLOSE = re.compile(r"^Close$")
# Rows in the account switcher read "wat2do.school, 3 follows and 2 more".
_SWITCHER_ROW = re.compile(r"^wat2do\.[a-z0-9._]+(?:, .*)?$")
_SWITCHER_SCROLLS = 3


def _sdk_tool(name: str, folder: str) -> str:
    found = shutil.which(name)
    if found:
        return found
    sdk = Path(os.environ.get("ANDROID_HOME") or Path.home() / "Library/Android/sdk")
    return str(sdk / folder / name)


def _adb_path() -> str:
    return _sdk_tool("adb", "platform-tools")


def emulator_command() -> list[str]:
    """Boot the configured virtual device headless on the port its serial names."""
    port = CONTROL.serial.removeprefix("emulator-")
    return [
        _sdk_tool("emulator", "emulator"),
        "-avd",
        CONTROL.avd_name,
        "-port",
        port,
        *CONTROL.emulator_arguments,
    ]


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

    def is_online(self) -> bool:
        try:
            return self.adb("get-state").strip() == "device"
        except EmulatorError:
            return False

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
                root = self._read_screen()
                break
            except EmulatorError:
                # The dump fails while the app is still animating, such as a playing video,
                # and sometimes prints an error in place of the screen.
                if attempt == _SCREEN_READ_ATTEMPTS - 1:
                    raise
                self._sleep(1)
        if root is None:
            return []
        nodes = []
        for element in root.iter("node"):
            match = _BOUNDS.fullmatch(element.get("bounds", ""))
            if not match:
                continue
            x1, y1, x2, y2 = (int(value) for value in match.groups())
            if x2 > x1 and y2 > y1:
                nodes.append(
                    Node(
                        element.get("text", ""),
                        element.get("content-desc", ""),
                        (x1, y1, x2, y2),
                        element.get("resource-id", "").rpartition("/")[2],
                    )
                )
        return nodes

    def _read_screen(self) -> ElementTree.Element | None:
        dump = self.adb("exec-out", "uiautomator", "dump", "/dev/tty")
        dump = dump.split(_DUMP_SUFFIX, 1)[0].strip()
        if not dump:
            return None
        try:
            return ElementTree.fromstring(dump)
        except ElementTree.ParseError as exc:
            raise EmulatorError("Emulator screen could not be read") from exc

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
            nodes = self.screen()
            node = self.find(pattern, nodes)
            if node is not None:
                return node
            prompt = self._prompt(nodes)
            if prompt is not None and not pattern.match(prompt.label):
                self.tap(prompt)
                continue
            if self._monotonic() >= deadline:
                raise EmulatorError(f"Instagram never showed {pattern.pattern}")
            self._sleep(1)

    def _prompt(self, nodes: list[Node]) -> Node | None:
        """The safe answer to a dialog covering the app, if one is showing.

        One-time announcements ("Introducing instants" and the like), the low storage
        warning and Android's not-responding dialog cover the app until answered;
        declining, closing or waiting is always safe. Login info is saved when offered
        after an account switch, so a later logout can come back without a password.
        """
        if self.find(_SAVE_LOGIN, nodes) is not None:
            return self.find(_SAVE, nodes)
        prompt = self.find(_NOT_NOW, nodes)
        if prompt is None and self.find(_LOW_STORAGE, nodes) is not None:
            prompt = self.find(_CLOSE, nodes)
        if prompt is None and self.find(_NOT_RESPONDING, nodes) is not None:
            prompt = self.find(_WAIT, nodes)
        return prompt

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

    def paste(self) -> None:
        self.pause()
        self.adb("shell", "input", "keyevent", "KEYCODE_PASTE")

    def clear_field(self) -> None:
        self.adb("shell", "input", "keycombination", *_SELECT_ALL)
        self.adb("shell", "input", "keyevent", "KEYCODE_DEL")

    def back(self) -> None:
        self.pause()
        self.adb("shell", "input", "keyevent", "KEYCODE_BACK")

    def type_text(self, text: str) -> None:
        """Type into the focused field one character at a time, at a person's pace."""
        for character in text:
            self._sleep(
                self._rng.uniform(
                    CONTROL.keystroke_delay_min_seconds, CONTROL.keystroke_delay_max_seconds
                )
            )
            # adb's input text reads %s as a space and needs shell metacharacters escaped.
            escaped = "%s" if character == " " else re.sub(r"([^A-Za-z0-9])", r"\\\1", character)
            self.adb("shell", "input", "text", escaped)

    def scroll_down(self) -> None:
        """Swipe up through the middle of the screen with a slightly uneven hand."""
        self.pause()
        x = round(self._rng.uniform(400, 680))
        start = round(self._rng.uniform(1600, 1800))
        end = round(self._rng.uniform(800, 1000))
        duration = round(self._rng.uniform(500, 900))
        self.adb(
            "shell",
            "input",
            "swipe",
            str(x),
            str(start),
            str(x + self._rng.randint(-20, 20)),
            str(end),
            str(duration),
        )

    def free_data_megabytes(self) -> int:
        """Free space on the device's data partition, where the app keeps everything."""
        line = self.adb("shell", "df", "-k", "/data").strip().splitlines()[-1]
        return int(line.split()[3]) // 1024

    def reclaim_data(self) -> int:
        """Once space runs low, clear app data the school accounts never need.

        Only apps listed in the controlbox are cleared, on Android users without a
        Google account, so nothing is lost: Google Play services rebuilds what it needs.
        Instagram's own data is never cleared, since that would log its accounts out.
        It runs at most once per ``reclaim_interval_hours``. Returns the free space.
        """
        free = self.free_data_megabytes()
        if free >= CONTROL.reclaim_below_data_megabytes or _reclaimed_recently():
            return free
        for user in CONTROL.reclaim_android_users:
            for package in CONTROL.reclaim_packages:
                self.adb("shell", "pm", "clear", "--user", str(user), package)
        _RECLAIMED_PATH.parent.mkdir(parents=True, exist_ok=True)
        _RECLAIMED_PATH.touch()
        return self.free_data_megabytes()

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
        # Every user left running keeps its apps in memory, and four of them swap the
        # emulator until Instagram stops responding. The system user cannot be stopped.
        for other in sorted(set(CONTROL.android_user_by_school.values()) - {0, user}):
            self.adb("shell", "am", "stop-user", str(other))

    def use_account(self, user: int, account_username: str) -> None:
        """Switch the app to the account, confirmed by the DM inbox's title.

        The inbox is read rather than the home feed: an autoplaying video there keeps
        the screen from ever going idle, and the screen reader gives up on it.
        """
        if self.open_inbox(user) == account_username:
            return
        self.tap(self.wait_for(_PROFILE_TAB), hold_ms=1200)
        self.tap(self._account_in_switcher(account_username))
        # The switch lands on the home feed; give it time before leaving for the inbox.
        self._sleep(CONTROL.screen_wait_seconds)
        if self.open_inbox(user) != account_username:
            raise EmulatorError("Instagram did not switch to the account")

    def open_inbox(self, user: int) -> str:
        """Open the DM inbox and return the username it belongs to."""
        self.open_instagram(user, INBOX_URL)
        try:
            title = self.wait_for(_INBOX_TITLE)
        except EmulatorError:
            # Right after an account switch the link can land before the app is ready;
            # the Messages tab always leads to the inbox.
            self.tap_when(_MESSAGES_TAB)
            title = self.wait_for(_INBOX_TITLE)
        return title.text.strip()

    def _account_in_switcher(self, account_username: str) -> Node:
        """The account's row in the switcher, scrolled into view: a full Android user's
        tenth account starts below the bottom of the screen."""
        account = re.compile(rf"^{re.escape(account_username)}$")
        self.wait_for(_SWITCHER_ROW)
        for _ in range(_SWITCHER_SCROLLS):
            node = self.find(account)
            if node is not None:
                return node
            self.scroll_down()
        return self.wait_for(account)

    def open_instagram(self, user: int, url: str | None = None) -> None:
        if url is None:
            target = ["-n", f"{CONTROL.instagram_package}/{_LAUNCHER_ACTIVITY}"]
        else:
            # adb hands the command to the device's shell, where "?" and "&" are special.
            target = [
                "-a",
                "android.intent.action.VIEW",
                "-d",
                shlex.quote(url),
                CONTROL.instagram_package,
            ]
        self.adb("shell", "am", "start", "--user", str(user), *target)


def _reclaimed_recently() -> bool:
    try:
        age = time.time() - _RECLAIMED_PATH.stat().st_mtime
    except FileNotFoundError:
        return False
    return age < CONTROL.reclaim_interval_hours * 3600


@contextmanager
def exclusive() -> Iterator[None]:
    """Hold the emulator for one job; another job waits until this one is done.

    A job may nest it, such as a DM job around the story repost it triggers; only
    the outermost hold takes the lock.
    """
    if getattr(_held, "depth", 0):
        _held.depth += 1
        try:
            yield
        finally:
            _held.depth -= 1
        return
    _LOCK_PATH.parent.mkdir(parents=True, exist_ok=True)
    with _LOCK_PATH.open("a") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        _held.depth = 1
        try:
            yield
        finally:
            _held.depth = 0
            fcntl.flock(handle, fcntl.LOCK_UN)
