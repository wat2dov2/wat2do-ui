"""One Android emulator, read through its accessibility tree and tapped at a human pace.

Every screen is located by the labels Instagram exposes to accessibility tools, never
by fixed coordinates, and every tap lands at a random point inside its control after
a random pause, so the app sees a person's rhythm rather than a script's. The tree is
read by a ``ScreenReader`` kept running on the device while the emulator is held.
"""

from __future__ import annotations

import fcntl
import io
import os
import random
import re
import shlex
import shutil
import subprocess
import threading
import time
import weakref
import xml.etree.ElementTree as ElementTree
from collections.abc import Callable, Iterable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import TypeVar

from PIL import Image

from core.controlbox import controlbox
from services.instagram_emulator.screen_reader import ScreenReader, ScreenReaderError

CONTROL = controlbox.instagram_emulator
_BOUNDS = re.compile(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]")
_LAUNCHER_ACTIVITY = "com.instagram.mainactivity.LauncherActivity"
_SCREEN_READ_ATTEMPTS = 5
# Every job that drives the emulator holds this lock, so two never tap at once.
_LOCK_PATH = Path.home() / ".local/state/wat2do/instagram-emulator.lock"
# Touched after each reclaim; the caches it deletes refill as the app is used, so
# clearing them on every visit only keeps the disk busy.
_RECLAIMED_PATH = Path.home() / ".local/state/wat2do/instagram-emulator-reclaimed"
_held = threading.local()
# Every device's screen reader; the end of each hold on the emulator stops them, so
# Android's accessibility service is connected only while a job drives the app.
_readers: weakref.WeakSet[ScreenReader] = weakref.WeakSet()
_RESTART_POLL_SECONDS = 5
# How often a wait reads the screen again; a read of a screen that has gone still is
# almost free, and one still changing waits for it to settle first.
_POLL_SECONDS = 0.5
# Dialogs one wait answers before it stops expecting the screen to change for them.
_PROMPTS_PER_WAIT = 5
_SELECT_ALL = ("113", "29")  # KEYCODE_CTRL_LEFT + KEYCODE_A
# Share of dark pixels in an icon's middle that means a check mark is drawn there.
_MARKED_DARK_SHARE = 0.2


class EmulatorError(RuntimeError):
    """The emulator or the Instagram app is not in a state the automation expects."""


_Seen = TypeVar("_Seen")


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
# Instagram is moving accounts to a new inbox header with a large auto-sized title.
_INBOX_TITLE = re.compile(r"^(igds_action_bar_title|action_bar_large_title_auto_size)$")
_INBOX_ATTEMPTS = 2
_SWITCH_ATTEMPTS = 2
_PROFILE_TAB = re.compile(r"^Profile$")
_SAVE_LOGIN = labels("Save your login info")
_SAVE = re.compile(r"^Save$")
_NOT_NOW = re.compile(r"^Not now$")
_LOW_STORAGE = labels("Low device storage")
# Android's own dialog when the app freezes for a few seconds on a busy emulator.
_NOT_RESPONDING = re.compile(r"^.+ isn't responding$")
_INSTAGRAM_NOT_RESPONDING = re.compile(r"^Instagram isn't responding$")
_WAIT = labels("Wait")
_CLOSE_APP = labels("Close app")
_CLOSE = re.compile(r"^Close$")
# Shown once per account, the first time it reposts anything; Close keeps the repost.
_FIRST_REPOST_NOTE = re.compile(r"^You reposted ")
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
        reader: ScreenReader | None = None,
    ) -> None:
        self._run = run
        self._sleep = sleep
        self._monotonic = monotonic
        self._rng = rng or random.SystemRandom()
        self._adb = _adb_path()
        self._reader = reader or ScreenReader(
            self._adb,
            CONTROL.serial,
            self.adb,
            settle_milliseconds=CONTROL.screen_settle_milliseconds,
            settle_wait_seconds=CONTROL.screen_settle_wait_seconds,
            timeout_seconds=CONTROL.adb_timeout_seconds,
        )
        _readers.add(self._reader)

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
                # The reader can fail to start or stop answering on a busy emulator (the
                # next read starts it again), and no window may be active for a moment.
                if attempt == _SCREEN_READ_ATTEMPTS - 1:
                    raise
                self._sleep(1)
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

    def _read_screen(self) -> ElementTree.Element:
        try:
            # Empty when no window is active, which does not parse either.
            return ElementTree.fromstring(self._reader.read())
        except (ScreenReaderError, ElementTree.ParseError) as exc:
            raise EmulatorError("Emulator screen could not be read") from exc

    def marked(self, icon: Node) -> bool:
        """Whether the icon shows a check mark in its middle.

        Instagram draws a few states, such as a post we reposted, only as a check mark
        inside the icon and leaves its label unchanged, so the screen's pixels are read.
        """
        x1, y1, x2, y2 = icon.bounds
        x, y, half = (x1 + x2) // 2, (y1 + y2) // 2, max(1, (x2 - x1) // 6)
        with Image.open(io.BytesIO(self.screenshot())) as screenshot:
            middle = screenshot.convert("L").crop((x - half, y - half, x + half, y + half))
            shades = middle.histogram()
        return sum(shades[:128]) / sum(shades) > _MARKED_DARK_SHARE

    def screenshot(self) -> bytes:
        """The screen as PNG bytes."""
        try:
            completed = self._run(
                [self._adb, "-s", CONTROL.serial, "exec-out", "screencap", "-p"],
                capture_output=True,
                timeout=CONTROL.adb_timeout_seconds,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise EmulatorError("adb screencap did not complete") from exc
        if completed.returncode != 0:
            raise EmulatorError("adb screencap failed")
        return completed.stdout

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
        node = self.watch(lambda nodes: self.find(pattern, nodes), seconds=seconds)
        if node is None:
            raise EmulatorError(f"Instagram never showed {pattern.pattern}")
        return node

    def watch(self, look: Callable[[list[Node]], _Seen], *, seconds: float | None = None) -> _Seen:
        """Read the screen until ``look`` finds what it is after, for at most ``seconds``
        (``screen_wait_seconds`` when not given), and return its last answer.

        ``look`` answers with something falsy while the screen does not show it yet.
        A screen that cannot be read yet, such as while the app starts afresh or Android
        switches users, is waited out too. A dialog covering the app is answered
        (``_prompt``) unless it is what ``look`` is after, a few at most, so one that
        will not go away cannot hold the wait forever.
        """
        deadline = self._monotonic() + (seconds or CONTROL.screen_wait_seconds)
        answered = 0
        while True:
            try:
                nodes = self.screen()
            except EmulatorError:
                if self._monotonic() >= deadline:
                    raise
                continue
            seen = look(nodes)
            if seen:
                return seen
            prompt = self._prompt(nodes)
            if prompt is not None and answered < _PROMPTS_PER_WAIT:
                self.tap(prompt)
                answered += 1
                continue
            if self._monotonic() >= deadline:
                return seen
            self._sleep(_POLL_SECONDS)

    def _prompt(self, nodes: list[Node]) -> Node | None:
        """The safe answer to a dialog covering the app, if one is showing.

        One-time announcements ("Introducing instants", the note after an account's
        first repost and the like), the low storage warning and Android's
        not-responding dialog cover the app until answered; declining, closing or
        waiting is always safe. A frozen Instagram rarely comes back, so it is closed
        and the next step reopens it; Android's own processes are waited for. Login
        info is saved when offered after an account switch, so a later logout can come
        back without a password.
        """
        if self.find(_SAVE_LOGIN, nodes) is not None:
            return self.find(_SAVE, nodes)
        prompt = self.find(_NOT_NOW, nodes)
        if prompt is None and (
            self.find(_LOW_STORAGE, nodes) is not None
            or self.find(_FIRST_REPOST_NOTE, nodes) is not None
        ):
            prompt = self.find(_CLOSE, nodes)
        if prompt is None and self.find(_INSTAGRAM_NOT_RESPONDING, nodes) is not None:
            prompt = self.find(_CLOSE_APP, nodes)
        if prompt is None and self.find(_NOT_RESPONDING, nodes) is not None:
            prompt = self.find(_WAIT, nodes)
        return prompt

    def wait_until_gone(self, pattern: re.Pattern[str], *, seconds: float) -> None:
        deadline = self._monotonic() + seconds
        while self.find(pattern) is not None:
            if self._monotonic() >= deadline:
                raise EmulatorError(f"Instagram kept showing {pattern.pattern}")
            self._sleep(_POLL_SECONDS)

    def tap(self, node: Node, *, hold_ms: int = 0) -> None:
        """Tap a control read earlier, after a person's pause."""
        self.pause()
        self._press(node, hold_ms)

    def tap_when(
        self, pattern: re.Pattern[str], *, seconds: float | None = None, hold_ms: int = 0
    ) -> None:
        """Tap the control once it shows, after a person's pause.

        The pause comes before the screen is read, so the screen settles while a person
        would still be looking at it, and the control is tapped where it ended up.
        """
        self.pause()
        self._press(self.wait_for(pattern, seconds=seconds), hold_ms)

    def _press(self, node: Node, hold_ms: int) -> None:
        x1, y1, x2, y2 = node.bounds
        # Land somewhere in the middle half of the control, never on its edge.
        x = round(self._rng.uniform(x1 + (x2 - x1) / 4, x2 - (x2 - x1) / 4))
        y = round(self._rng.uniform(y1 + (y2 - y1) / 4, y2 - (y2 - y1) / 4))
        if hold_ms:
            self.adb("shell", "input", "swipe", str(x), str(y), str(x), str(y), str(hold_ms))
        else:
            self.adb("shell", "input", "tap", str(x), str(y))

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
        self._swipe(start=(1600, 1800), end=(800, 1000))

    def scroll_up(self) -> None:
        """Drag down a little through the middle of the screen, back towards older content.

        A shorter drag than ``scroll_down``, so content just above the screen comes into
        view without what is on screen leaving it.
        """
        self._swipe(start=(850, 950), end=(1250, 1350))

    def _swipe(self, *, start: tuple[int, int], end: tuple[int, int]) -> None:
        self.pause()
        x = round(self._rng.uniform(400, 680))
        duration = round(self._rng.uniform(500, 900))
        self.adb(
            "shell",
            "input",
            "swipe",
            str(x),
            str(round(self._rng.uniform(*start))),
            str(x + self._rng.randint(-20, 20)),
            str(round(self._rng.uniform(*end))),
            str(duration),
        )

    def free_data_megabytes(self) -> int:
        """Free space on the device's data partition, where the app keeps everything."""
        line = self.adb("shell", "df", "-k", "/data").strip().splitlines()[-1]
        return int(line.split()[3]) // 1024

    def reclaim_data(self) -> int:
        """Delete what Instagram keeps piling up; returns the free space.

        Instagram never trims its own image cache, downloaded camera effects or models,
        so on every Android user that holds accounts the app is stopped and those
        folders, listed in the controlbox, are deleted as root. Its login, databases and
        settings stay, so no account is logged out, and the app is left out of Android's
        stopped state (``_unstop``). No other app's data is cleared: clearing Google Play
        services dropped the Android user's device and push registration. The emulator is
        then restarted, since its host process leaks memory. It runs once a day, when
        ``reclaim_due`` says so.
        """
        if not reclaim_due():
            return self.free_data_megabytes()
        package = CONTROL.instagram_package
        for user in sorted(set(CONTROL.android_user_by_school.values())):
            folder = f"/data/user/{user}/{package}"
            paths = " ".join(f"{folder}/{path}" for path in CONTROL.instagram_cache_paths)
            self.adb(
                "shell",
                "su",
                "0",
                "sh",
                "-c",
                shlex.quote(f"am force-stop --user {user} {package} && rm -rf {paths}"),
            )
            self._unstop(user)
        _RECLAIMED_PATH.parent.mkdir(parents=True, exist_ok=True)
        _RECLAIMED_PATH.touch()
        self.restart()
        return self.free_data_megabytes()

    def restart(self) -> None:
        """Stop the emulator and wait for the ``run`` LaunchAgent to boot a fresh one.

        The emulator's host process grows by about 3 GB a day with ``-gpu host`` and
        only gives the memory back when it exits. Its accounts live on the device's
        disk, so they stay logged in.
        """
        self._reader.stop()
        self.adb("emu", "kill")
        deadline = self._monotonic() + CONTROL.restart_timeout_seconds
        stopped = False
        while self._monotonic() < deadline:
            # The old emulator answers until it exits; only a new one's boot counts.
            if not stopped:
                stopped = not self.is_online()
            elif self._booted():
                self._sleep(CONTROL.screen_wait_seconds)
                self.wake()
                return
            self._sleep(_RESTART_POLL_SECONDS)
        raise EmulatorError("The emulator did not come back after a restart")

    def _booted(self) -> bool:
        try:
            return self.adb("shell", "getprop", "sys.boot_completed").strip() == "1"
        except EmulatorError:
            return False

    def wake(self) -> None:
        self.adb("shell", "input", "keyevent", "KEYCODE_WAKEUP")
        self.adb("shell", "wm", "dismiss-keyguard")

    def use_android_user(self, user: int) -> None:
        """Bring the Android user that holds the account to the foreground, waiting only
        until it is in front, unlocked and on screen, at most ``user_switch_wait_seconds``.

        For a dozen seconds after Android reports the switch, its own switching screen
        and then a blank one hold the display: nothing can be read, and a link opened
        then lands late. The user's own screen (its last app, or the home screen) comes
        back by itself; a switch whose screen is slower than the wait goes on anyway.
        """
        if self.adb("shell", "am", "get-current-user").strip() == str(user):
            return
        self.adb("shell", "am", "switch-user", str(user))
        deadline = self._monotonic() + CONTROL.user_switch_wait_seconds
        while not self._user_ready(user):
            if self._monotonic() >= deadline:
                raise EmulatorError("Emulator did not switch Android users")
            self._sleep(_POLL_SECONDS)
        self.wake()
        while not self._user_on_screen(user) and self._monotonic() < deadline:
            self._sleep(_POLL_SECONDS)

    def _user_ready(self, user: int) -> bool:
        return self.adb("shell", "am", "get-current-user").strip() == str(
            user
        ) and "RUNNING_UNLOCKED" in self.adb("shell", "am", "get-started-user-state", str(user))

    def _user_on_screen(self, user: int) -> bool:
        """Whether one of the user's own windows has the focus and can be read."""
        try:
            focus = self.adb("shell", "dumpsys window | grep -m1 mCurrentFocus")
            if f" u{user} " not in focus:
                return False
            self._read_screen()
        except EmulatorError:
            return False
        return True

    def use_account(self, user: int, account_username: str) -> None:
        """Switch the app to the account, confirmed by the DM inbox's title.

        The inbox is read rather than the home feed: an autoplaying video there keeps
        the screen from ever going idle, and the screen reader gives up on it. An
        attempt that fails starts the app afresh for the next one, since a sheet or
        dialog left open by an earlier step can keep the inbox from ever showing.
        """
        for _ in range(_SWITCH_ATTEMPTS):
            try:
                if self.open_inbox(user) == account_username:
                    return
                self.tap_when(_PROFILE_TAB, hold_ms=1200)
                # A tap while the account sheet is still sliding up can miss, leaving the
                # sheet open; the next attempt notices and switches again.
                self.tap(self._account_in_switcher(account_username))
            except EmulatorError:
                self.reset_app(user)
                continue
            # The switch lands on the home feed; let it settle before leaving for the
            # inbox, which opens again if its link still lands too early.
            self._sleep(CONTROL.account_switch_settle_seconds)
        if self.open_inbox(user) != account_username:
            raise EmulatorError("Instagram did not switch to the account")

    def reset_app(self, user: int) -> None:
        """Close Instagram on the Android user, so the next link starts it afresh.

        A step that fails can leave a sheet or dialog open over the app, and every link
        opened after it lands underneath, out of the screen reader's sight. The app
        reopens on the account it was on, and is left out of Android's stopped state
        (``_unstop``).
        """
        self.adb("shell", "am", "force-stop", "--user", str(user), CONTROL.instagram_package)
        self._unstop(user)

    def _unstop(self, user: int) -> None:
        """Take Instagram out of the stopped state ``am force-stop`` leaves it in.

        A force stop also marks the app stopped, as if it had never been opened, and
        Android then delivers it nothing in the background (its broadcasts, alarms,
        scheduled jobs and push messages) until it is launched again. ``pm unstop`` leaves
        it closed the way a person closing it would, so the force stop only closes it.
        """
        self.adb("shell", "pm", "unstop", "--user", str(user), CONTROL.instagram_package)

    def open_inbox(self, user: int) -> str:
        """Open the DM inbox and return the username it belongs to."""
        for _ in range(_INBOX_ATTEMPTS):
            self.open_instagram(user, INBOX_URL)
            try:
                return self.wait_for(_INBOX_TITLE).text.strip()
            except EmulatorError:
                # The link can land before the app is ready right after a switch, or an
                # account sheet left open can cover the inbox; Back closes either.
                self.back()
        raise EmulatorError("Instagram's DM inbox could not be opened")

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


def reclaim_due(now: datetime | None = None) -> bool:
    """Whether the daily reclaim and restart has not run since the last ``reclaim_hour``.

    A fixed hour keeps the restart before the morning's carousels publish, instead of
    drifting into the hours their songs are added.
    """
    moment = (now or datetime.now()).astimezone()
    since = moment.replace(hour=CONTROL.reclaim_hour, minute=0, second=0, microsecond=0)
    if moment < since:
        since -= timedelta(days=1)
    try:
        reclaimed = datetime.fromtimestamp(_RECLAIMED_PATH.stat().st_mtime).astimezone()
    except FileNotFoundError:
        return True
    return reclaimed < since


@contextmanager
def exclusive() -> Iterator[None]:
    """Hold the emulator for one job; another job waits until this one is done.

    A job may nest it, such as a DM job around the story repost it triggers; only
    the outermost hold takes the lock, and its end stops the screen readers.
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
            for reader in list(_readers):
                reader.stop()
            fcntl.flock(handle, fcntl.LOCK_UN)
