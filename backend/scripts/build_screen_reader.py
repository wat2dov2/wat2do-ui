#!/usr/bin/env python3
"""Build the emulator's screen reader, ``services/instagram_emulator/screen-reader.jar``.

``ScreenReader.java`` is compiled against the Android SDK's platform with a JDK's
javac, turned into Android bytecode by d8 from the pinned r8 release on Google's Maven
repository (downloaded once and checked against its SHA-256), and packed with the
source's SHA-256, which the tests compare with the source so the committed jar never
falls behind it. The worker only copies the jar to the device and needs no JDK.
"""

from __future__ import annotations

import hashlib
import os
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

BACKEND_DIRECTORY = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIRECTORY))

from services.instagram_emulator.screen_reader import (  # noqa: E402
    JAR,
    SOURCE,
    SOURCE_HASH_ENTRY,
    source_hash,
)

R8_VERSION = "8.11.18"
R8_SHA256 = "fbe6f7d59d46d6296919f6cc4793536439921d357c9a6bbf45ea4acc3c8736a7"
R8_URL = (
    f"https://dl.google.com/dl/android/maven2/com/android/tools/r8/{R8_VERSION}/r8-{R8_VERSION}.jar"
)
ANDROID_PLATFORM = "android-35"
# Fixed entry times, so the same source always builds the same jar.
ENTRY_TIME = (1980, 1, 1, 0, 0, 0)


def main() -> int:
    sdk = Path(os.environ.get("ANDROID_HOME") or Path.home() / "Library/Android/sdk")
    android_jar = sdk / "platforms" / ANDROID_PLATFORM / "android.jar"
    if not android_jar.is_file():
        raise SystemExit(f"The Android SDK has no {ANDROID_PLATFORM} platform at {android_jar}")
    r8 = _r8()
    with tempfile.TemporaryDirectory(prefix="wat2do-screen-reader-") as work:
        classes = Path(work) / "classes"
        subprocess.run(
            ["javac", "--release", "11", "-cp", str(android_jar), "-d", str(classes), str(SOURCE)],
            check=True,
        )
        dexed = Path(work) / "dexed.jar"
        subprocess.run(
            [
                "java",
                "-cp",
                str(r8),
                "com.android.tools.r8.D8",
                "--release",
                "--min-api",
                "35",
                "--lib",
                str(android_jar),
                "--output",
                str(dexed),
                *(str(path) for path in sorted(classes.rglob("*.class"))),
            ],
            check=True,
        )
        with zipfile.ZipFile(dexed) as built:
            dex = built.read("classes.dex")
    with zipfile.ZipFile(JAR, "w") as jar:
        jar.writestr(zipfile.ZipInfo("classes.dex", ENTRY_TIME), dex)
        jar.writestr(zipfile.ZipInfo(SOURCE_HASH_ENTRY, ENTRY_TIME), source_hash())
    print(f"Built {JAR.relative_to(BACKEND_DIRECTORY)}")
    return 0


def _r8() -> Path:
    """The pinned r8 jar, downloaded into the user's cache the first time."""
    cached = Path.home() / ".cache/wat2do" / f"r8-{R8_VERSION}.jar"
    if not cached.is_file() or _sha256(cached) != R8_SHA256:
        cached.parent.mkdir(parents=True, exist_ok=True)
        downloading = cached.with_suffix(".download")
        with urllib.request.urlopen(R8_URL, timeout=120) as response:
            downloading.write_bytes(response.read())
        if _sha256(downloading) != R8_SHA256:
            downloading.unlink()
            raise SystemExit(f"r8 {R8_VERSION} did not match its pinned SHA-256")
        downloading.replace(cached)
    return cached


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


if __name__ == "__main__":
    raise SystemExit(main())
