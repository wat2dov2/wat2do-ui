#!/usr/bin/env python3
"""
Set "Posts -> All" notifications for every account on Instagram's
"All profiles you follow" screen, driving a running Android emulator over ADB.

You open that screen yourself first. This script does not launch Instagram,
switch accounts, or navigate menus. It assumes the consolidated list is already
visible and only walks it top to bottom: tap each row's bell -> Posts -> All.

The per-row bell is a plain clickable ImageView on the right edge of the row
with NO resource-id, text, or content-desc, so it cannot be found by label -
it is identified purely by class, clickability, and position within the row.
"""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import re
import subprocess
import sys
import tempfile
import time
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Sequence

BACKEND_DIRECTORY = Path(__file__).resolve().parents[1]
if str(BACKEND_DIRECTORY) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIRECTORY))

from core.controlbox import controlbox  # noqa: E402
from scripts.emulator_farm import default_paths  # noqa: E402

CONTROL = controlbox.instagram_bell_setup
ADB_PATH = str(default_paths().adb)
TARGET_DEVICE: str | None = None


class BellSetupError(RuntimeError):
    """Notification setup could not verify its intended change."""


# --------------------------------------------------------------------------- #
# ADB primitives
# --------------------------------------------------------------------------- #


def run_cmd(args, *, timeout=None):
    """Run an adb/shell command and return stdout, targeting the chosen device."""
    if TARGET_DEVICE and args and args[0] == ADB_PATH:
        args = [ADB_PATH, "-s", TARGET_DEVICE] + args[1:]
    try:
        res = subprocess.run(
            args,
            capture_output=True,
            text=True,
            check=True,
            timeout=CONTROL.command_timeout_seconds if timeout is None else timeout,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise BellSetupError(f"ADB command failed ({type(exc).__name__})") from exc
    return res.stdout.strip()


def tap(x, y):
    print(f"  tap ({x}, {y})")
    run_cmd([ADB_PATH, "shell", "input", "tap", str(x), str(y)])
    time.sleep(CONTROL.tap_settle_seconds)


def press_back():
    run_cmd([ADB_PATH, "shell", "input", "keyevent", "4"])
    time.sleep(CONTROL.tap_settle_seconds)


def scroll_down():
    print("  scroll down")
    run_cmd([ADB_PATH, "shell", "input", "swipe", "500", "1800", "500", "800", "500"])
    time.sleep(CONTROL.scroll_settle_seconds)


def disable_animations():
    """Zero out system animations so uiautomator dumps are instant and reliable."""
    for key in ("window_animation_scale", "transition_animation_scale", "animator_duration_scale"):
        try:
            run_cmd([ADB_PATH, "shell", "settings", "put", "global", key, "0"])
        except BellSetupError:
            print(f"Could not disable {key}; continuing with verified UI steps.")


def dump_ui(retries=None, *, timeout=None):
    """Dump and parse the current UI tree. Returns the root node or None."""
    retries = CONTROL.dump_retry_limit if retries is None else retries
    deadline = time.monotonic() + timeout if timeout is not None else None
    with tempfile.TemporaryDirectory(prefix="wat2do-instagram-ui-") as directory:
        local = Path(directory) / "window.xml"
        for _ in range(retries + 1):
            if deadline is not None and time.monotonic() >= deadline:
                break
            try:
                remaining = None if deadline is None else max(0.001, deadline - time.monotonic())
                run_cmd(
                    [ADB_PATH, "shell", "uiautomator", "dump", "/sdcard/window_dump.xml"],
                    timeout=remaining,
                )
                remaining = None if deadline is None else max(0.001, deadline - time.monotonic())
                run_cmd(
                    [ADB_PATH, "pull", "/sdcard/window_dump.xml", str(local)], timeout=remaining
                )
                return ET.parse(local).getroot()
            except (BellSetupError, OSError, ET.ParseError):
                if deadline is None:
                    time.sleep(CONTROL.dump_retry_delay_seconds)
    return None


# --------------------------------------------------------------------------- #
# UI helpers
# --------------------------------------------------------------------------- #


def center(node):
    """Center (x, y) of a node's bounds, or None."""
    m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", node.get("bounds", ""))
    if not m:
        return None
    x1, y1, x2, y2 = map(int, m.groups())
    return (x1 + x2) // 2, (y1 + y2) // 2


def find_text(root, target):
    """First node whose text or content-desc equals target (case-sensitive)."""
    for n in root.findall(".//node"):
        if n.get("text", "") == target or n.get("content-desc", "") == target:
            return n
    return None


def wait_for(condition, timeout=None):
    """Poll the UI until condition(root) is true. Returns the root or None."""
    timeout = CONTROL.ui_wait_timeout_seconds if timeout is None else timeout
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        root = dump_ui(retries=0, timeout=max(0.001, end - time.monotonic()))
        if root is not None and condition(root):
            return root
        time.sleep(CONTROL.ui_poll_interval_seconds)
    return None


def row_bell(container):
    """The bell inside a consolidated-list row: an unlabelled clickable
    ImageView sitting on the right edge of the row. Returns (x, y) or None."""
    for n in container.iter("node"):
        if n.get("class") == "android.widget.ImageView" and n.get("clickable") == "true":
            coords = center(n)
            if coords and coords[0] > CONTROL.bell_x_min:
                return coords
    return None


def set_all_for_bell(bell_coords):
    """Tap a bell on the consolidated list -> Posts -> All, then let the sheet
    close back onto the list. Returns True if 'All' is now selected."""
    tap(*bell_coords)

    sheet = wait_for(
        lambda r: find_text(r, "Posts") is not None, timeout=CONTROL.menu_open_timeout_seconds
    )
    if sheet is None:
        print("    notifications sheet did not open; skipping.")
        press_back()
        return False

    posts = find_text(sheet, "Posts")
    if _posts_status(sheet) == "All":
        print("    already set to All.")
        press_back()
        return True

    position = center(posts)
    if position is None:
        press_back()
        return False
    tap(*position)
    sub = wait_for(lambda r: find_text(r, "All") is not None)
    if sub is None:
        print("    'Posts' sub-menu did not open; skipping.")
        press_back()
        return False
    position = center(find_text(sub, "All"))
    if position is None:
        press_back()
        return False
    tap(*position)
    time.sleep(CONTROL.selection_settle_seconds)

    # Selecting All closes the menu back onto the list; make sure it is gone.
    for _ in range(CONTROL.max_menu_close_attempts):
        root = dump_ui()
        if root is None:
            return False
        if find_text(root, "Posts") is None:
            break
        press_back()
    else:
        return False
    # Reopen once to read the setting, without replaying any uncertain action.
    tap(*bell_coords)
    for _ in range(CONTROL.verification_retry_limit + 1):
        sheet = wait_for(lambda r: find_text(r, "Posts") is not None)
        if sheet is not None and _posts_status(sheet) == "All":
            press_back()
            return True
    press_back()
    return False


def _posts_status(root):
    """Read the status in the closest container that owns the Posts label."""
    for container in reversed(list(root.iter("node"))):
        if find_text(container, "Posts") is None:
            continue
        status = container.find(
            ".//node[@resource-id='com.instagram.android:id/context_menu_item_sub_label']"
        )
        if status is not None:
            return status.get("text")
    return None


def consolidated_rows(root):
    """(username, bell_coords) for each row on the consolidated list."""
    rows = []
    for c in root.findall(".//node[@resource-id='com.instagram.android:id/row_user_container']"):
        name_node = c.find(".//node[@resource-id='com.instagram.android:id/row_user_username']")
        name = name_node.get("text") if name_node is not None else None
        bell = row_bell(c)
        if name and bell:
            rows.append((name, bell))
    return rows


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #


def run():
    print("Walking the consolidated list (already open)...")
    attempted = set()
    confirmed = set()
    failed = set()
    prev_visible = set()
    stale_scrolls = 0
    dump_failures = 0
    deadline = time.monotonic() + CONTROL.run_timeout_seconds

    while stale_scrolls < CONTROL.stale_scroll_limit:
        if time.monotonic() >= deadline:
            raise BellSetupError(
                f"Setup timed out after {len(confirmed)} confirmed and {len(failed)} failed accounts"
            )
        root = dump_ui()
        if root is None:
            dump_failures += 1
            if dump_failures >= CONTROL.max_consecutive_dump_failures:
                raise BellSetupError(
                    f"UI remained unavailable after {len(confirmed)} confirmed and {len(failed)} failed accounts"
                )
            time.sleep(CONTROL.unavailable_ui_delay_seconds)
            continue
        dump_failures = 0

        rows = consolidated_rows(root)
        if not attempted and not rows:
            raise BellSetupError(
                "No following rows were verified; open 'All profiles you follow' before retrying"
            )
        visible = {name for name, _ in rows}

        target = next(
            (
                (name, bell)
                for name, bell in rows
                if name not in attempted and CONTROL.safe_y_min <= bell[1] <= CONTROL.safe_y_max
            ),
            None,
        )

        if target:
            name, bell = target
            print(f"[{len(attempted) + 1}] {name}")
            try:
                success = set_all_for_bell(bell)
            except BellSetupError as exc:
                raise BellSetupError(
                    f"Setup stopped after {len(confirmed)} confirmed and {len(failed) + 1} failed or unconfirmed accounts ({type(exc).__name__})"
                ) from exc
            attempted.add(name)
            (confirmed if success else failed).add(name)
            stale_scrolls = 0
            continue  # re-dump: the sheet flow changed the screen

        # No unprocessed bell on screen -> scroll for more. An empty screen
        # counts as stale too, so a detection failure cannot scroll forever.
        if not visible or visible.issubset(prev_visible):
            stale_scrolls += 1
        else:
            stale_scrolls = 0
        prev_visible = visible
        scroll_down()

    print(
        f"\nConfirmed Posts -> All for {len(confirmed)} accounts; {len(failed)} failed or unconfirmed."
    )
    if not attempted:
        raise BellSetupError(
            "No following rows were verified; open 'All profiles you follow' before retrying"
        )
    return {"confirmed": len(confirmed), "failed": len(failed)}


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Instagram bell notification enabler. "
            "Open 'All profiles you follow' on the emulator first, then run this."
        )
    )
    parser.add_argument("--device", help="Target ADB device serial (e.g. emulator-5556)")
    args = parser.parse_args(argv)

    global TARGET_DEVICE

    if not Path(ADB_PATH).is_file():
        raise BellSetupError(f"ADB not found at {ADB_PATH}")

    devices = run_cmd([ADB_PATH, "devices"])
    print(devices)
    connected = [
        line.split()[0] for line in devices.splitlines()[1:] if line.strip().endswith("device")
    ]
    if not connected:
        raise BellSetupError("No emulator/device connected.")

    if args.device:
        if args.device not in connected:
            raise BellSetupError(f"Device {args.device} not connected.")
        TARGET_DEVICE = args.device
    else:
        if len(connected) > 1:
            raise BellSetupError(
                "Multiple devices are connected; select the intended device with --device"
            )
        TARGET_DEVICE = connected[0]
        print(f"No --device given, using {TARGET_DEVICE}")

    state_directory = default_paths().state_directory
    state_directory.mkdir(parents=True, exist_ok=True)
    device_key = hashlib.sha256(TARGET_DEVICE.encode("utf-8")).hexdigest()
    with (state_directory / f"bell-setup-{device_key}.lock").open("a+") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise BellSetupError("Notification setup is already active on this device") from None
        disable_animations()
        return int(bool(run()["failed"]))


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (BellSetupError, OSError) as exc:
        print(f"Notification setup failed: {exc}", file=sys.stderr)
        raise SystemExit(1) from None
