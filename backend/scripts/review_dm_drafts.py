#!/usr/bin/env python3
"""Open a school account's DM inbox on the emulator's screen, to read its drafts and send them.

Sittings type every DM reply into its thread and leave it unsent; the draft lives in
that thread on the emulator only, which runs without a window. This waits for the
emulator worker to finish what it is doing, switches the app to the school's account,
opens its inbox and shows the emulator in a scrcpy window (``brew install scrcpy``).
The worker waits while the window is open; closing it hands the emulator back.

Usage: ``.venv/bin/python scripts/review_dm_drafts.py <school>``, from ``backend/``.
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

BACKEND_DIRECTORY = Path(__file__).resolve().parents[1]
if str(BACKEND_DIRECTORY) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIRECTORY))

from services.instagram_accounts import school_account_username  # noqa: E402
from services.instagram_emulator.device import (  # noqa: E402
    CONTROL,
    EmulatorDevice,
    adb_path,
    exclusive,
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("school", choices=sorted(CONTROL.android_user_by_school))
    school = parser.parse_args().school
    viewer = shutil.which("scrcpy")
    if viewer is None:
        print("Install the viewer first: brew install scrcpy")
        return 1
    print("Waiting for the emulator to finish its current job...", flush=True)
    with exclusive():
        device = EmulatorDevice()
        user = CONTROL.android_user_by_school[school]
        device.wake()
        device.use_android_user(user)
        device.use_account(user, school_account_username(school))
        device.open_inbox(user)
        device.release_screen()
        print(
            f"{school_account_username(school)}'s inbox is open; the worker waits until you close the window."
        )
        subprocess.run(
            [viewer, "--serial", CONTROL.serial, "--window-title", f"{school}: DM drafts"],
            env={**os.environ, "ADB": adb_path()},
            check=False,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
