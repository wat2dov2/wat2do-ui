"""Install local LaunchAgents without losing a previously working service."""

from __future__ import annotations

import os
import plistlib
import subprocess
import tempfile
from pathlib import Path
from typing import Any


def _stage(path: Path, payload: bytes) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise
    return temporary


def atomic_write(path: Path, payload: bytes) -> None:
    """Flush a private replacement before touching the existing durable file."""
    temporary = _stage(path, payload)
    try:
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def _launchctl(arguments: list[str], timeout: float, *, check: bool = True) -> bool:
    try:
        result = subprocess.run(
            ["launchctl", *arguments], capture_output=True, text=True, timeout=timeout
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise RuntimeError(f"LaunchAgent {arguments[0]} failed ({type(exc).__name__})") from exc
    if check and result.returncode:
        raise RuntimeError(f"LaunchAgent {arguments[0]} failed (exit {result.returncode})")
    return result.returncode == 0


def install_launch_agent(path: Path, payload: dict[str, Any], *, timeout: float) -> None:
    """Validate storage first and restore the previous agent if replacement fails."""
    label = payload["Label"]
    domain = f"gui/{os.getuid()}"
    service = f"{domain}/{label}"
    previous = path.read_bytes() if path.exists() else None
    loaded = _launchctl(["print", service], timeout, check=False)
    replacement = plistlib.dumps(payload, sort_keys=True)
    # Stage all writes while the previous service is still available.
    candidate = _stage(path, replacement)
    stop_attempted = False
    replaced = False
    try:
        _launchctl(["enable", service], timeout)
        if loaded:
            stop_attempted = True
            _launchctl(["bootout", service], timeout)
        candidate.replace(path)
        replaced = True
        _launchctl(["bootstrap", domain, str(path)], timeout)
    except (OSError, RuntimeError) as exc:
        try:
            if replaced:
                _launchctl(["bootout", service], timeout, check=False)
                if previous is None:
                    path.unlink(missing_ok=True)
                else:
                    atomic_write(path, previous)
            if stop_attempted and not _launchctl(["print", service], timeout, check=False):
                _launchctl(["bootstrap", domain, str(path)], timeout)
        except (OSError, RuntimeError) as recovery:
            raise RuntimeError(
                f"LaunchAgent replacement failed; previous service recovery also failed ({type(recovery).__name__})"
            ) from exc
        raise
    finally:
        candidate.unlink(missing_ok=True)
