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

import argparse
import os
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

ADB_PATH = "/Users/tonyqiu/Library/Android/sdk/platform-tools/adb"
TEMP_XML_PATH = "/tmp/instagram_window_dump.xml"

# Only tap rows whose bell sits inside the scrollable list body (skip the
# status bar / action bar at the top and the nav bar at the bottom).
SAFE_Y_MIN = 450
SAFE_Y_MAX = 2150

TARGET_DEVICE = None


# --------------------------------------------------------------------------- #
# ADB primitives
# --------------------------------------------------------------------------- #


def run_cmd(args):
    """Run an adb/shell command and return stdout, targeting the chosen device."""
    if TARGET_DEVICE and args and args[0] == ADB_PATH:
        args = [ADB_PATH, "-s", TARGET_DEVICE] + args[1:]
    res = subprocess.run(args, capture_output=True, text=True, check=True)
    return res.stdout.strip()


def tap(x, y):
    print(f"  tap ({x}, {y})")
    run_cmd([ADB_PATH, "shell", "input", "tap", str(x), str(y)])
    time.sleep(0.6)


def press_back():
    run_cmd([ADB_PATH, "shell", "input", "keyevent", "4"])
    time.sleep(0.6)


def scroll_down():
    print("  scroll down")
    run_cmd([ADB_PATH, "shell", "input", "swipe", "500", "1800", "500", "800", "500"])
    time.sleep(0.8)


def disable_animations():
    """Zero out system animations so uiautomator dumps are instant and reliable."""
    for key in ("window_animation_scale", "transition_animation_scale", "animator_duration_scale"):
        try:
            run_cmd([ADB_PATH, "shell", "settings", "put", "global", key, "0"])
        except subprocess.CalledProcessError:
            pass


def dump_ui(retries=2):
    """Dump and parse the current UI tree. Returns the root node or None."""
    for _ in range(retries + 1):
        try:
            run_cmd([ADB_PATH, "shell", "uiautomator", "dump", "/sdcard/window_dump.xml"])
            run_cmd([ADB_PATH, "pull", "/sdcard/window_dump.xml", TEMP_XML_PATH])
            return ET.parse(TEMP_XML_PATH).getroot()
        except Exception:
            time.sleep(0.8)
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


def wait_for(condition, timeout=5.0):
    """Poll the UI until condition(root) is true. Returns the root or None."""
    end = time.time() + timeout
    while time.time() < end:
        root = dump_ui()
        if root is not None and condition(root):
            return root
        time.sleep(0.5)
    return None


def row_bell(container):
    """The bell inside a consolidated-list row: an unlabelled clickable
    ImageView sitting on the right edge of the row. Returns (x, y) or None."""
    for n in container.iter("node"):
        if n.get("class") == "android.widget.ImageView" and n.get("clickable") == "true":
            coords = center(n)
            if coords and coords[0] > 700:
                return coords
    return None


def set_all_for_bell(bell_coords):
    """Tap a bell on the consolidated list -> Posts -> All, then let the sheet
    close back onto the list. Returns True if 'All' is now selected."""
    tap(*bell_coords)

    sheet = wait_for(lambda r: find_text(r, "Posts") is not None, timeout=3.5)
    if sheet is None:
        print("    notifications sheet did not open; skipping.")
        press_back()
        return False

    posts = find_text(sheet, "Posts")
    current = posts.find(
        ".//node[@resource-id='com.instagram.android:id/context_menu_item_sub_label']"
    )
    if current is not None and current.get("text") == "All":
        print("    already set to All.")
        press_back()
        return True

    tap(*center(posts))
    sub = wait_for(lambda r: find_text(r, "All") is not None, timeout=5.0)
    if sub is None:
        print("    'Posts' sub-menu did not open; skipping.")
        press_back()
        return False
    tap(*center(find_text(sub, "All")))
    time.sleep(0.8)

    # Selecting All closes the menu back onto the list; make sure it is gone.
    for _ in range(3):
        root = dump_ui()
        if root is None or find_text(root, "Posts") is None:
            return True
        press_back()
    return True


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
    processed = set()
    prev_visible = set()
    stale_scrolls = 0

    while stale_scrolls < 3:
        root = dump_ui()
        if root is None:
            time.sleep(1.5)
            continue

        rows = consolidated_rows(root)
        visible = {name for name, _ in rows}

        target = next(
            (
                (name, bell)
                for name, bell in rows
                if name not in processed and SAFE_Y_MIN <= bell[1] <= SAFE_Y_MAX
            ),
            None,
        )

        if target:
            name, bell = target
            print(f"[{len(processed) + 1}] {name}")
            set_all_for_bell(bell)
            processed.add(name)
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

    print(f"\nDone. Set Posts -> All for {len(processed)} accounts.")


def main():
    parser = argparse.ArgumentParser(
        description=(
            "Instagram bell notification enabler. "
            "Open 'All profiles you follow' on the emulator first, then run this."
        )
    )
    parser.add_argument("--device", help="Target ADB device serial (e.g. emulator-5556)")
    args = parser.parse_known_args()[0]

    global TARGET_DEVICE

    if not os.path.exists(ADB_PATH):
        sys.exit(f"ADB not found at {ADB_PATH}")

    devices = run_cmd([ADB_PATH, "devices"])
    print(devices)
    connected = [
        line.split()[0] for line in devices.splitlines()[1:] if line.strip().endswith("device")
    ]
    if not connected:
        sys.exit("No emulator/device connected.")

    if args.device:
        if args.device not in connected:
            sys.exit(f"Device {args.device} not connected.")
        TARGET_DEVICE = args.device
    else:
        TARGET_DEVICE = connected[0]
        print(f"No --device given, using {TARGET_DEVICE}")

    disable_animations()
    run()


if __name__ == "__main__":
    main()
