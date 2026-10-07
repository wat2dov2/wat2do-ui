"""Install local LaunchAgents without losing a previously working service."""

from __future__ import annotations

import os
import plistlib
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any


class LaunchAgentRecoveryError(RuntimeError):
    """A service replacement could not confirm recovery of the previous agent."""


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


def _wait_for_unload(service: str, *, timeout: float, poll_interval_seconds: float) -> None:
    """Launchd may retain the stopped service entry after bootout returns."""
    deadline = time.monotonic() + timeout
    while (remaining := deadline - time.monotonic()) > 0:
        if not _launchctl(["print", service], remaining, check=False):
            return
        remaining = deadline - time.monotonic()
        if remaining > 0:
            time.sleep(min(poll_interval_seconds, remaining))
    raise RuntimeError("LaunchAgent unload timed out; service is still registered")


def install_launch_agent(
    path: Path, payload: dict[str, Any], *, timeout: float, poll_interval_seconds: float
) -> None:
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
            _wait_for_unload(service, timeout=timeout, poll_interval_seconds=poll_interval_seconds)
        candidate.replace(path)
        replaced = True
        _launchctl(["bootstrap", domain, str(path)], timeout)
    except (OSError, RuntimeError, KeyboardInterrupt, SystemExit) as exc:
        recovery_error: OSError | RuntimeError | None = None
        try:
            if replaced:
                _launchctl(["bootout", service], timeout, check=False)
                _wait_for_unload(
                    service, timeout=timeout, poll_interval_seconds=poll_interval_seconds
                )
            elif stop_attempted:
                _wait_for_unload(
                    service, timeout=timeout, poll_interval_seconds=poll_interval_seconds
                )
        except (OSError, RuntimeError) as recovery:
            recovery_error = recovery
        try:
            # Preserve the old configuration even when launchd cannot settle.
            if replaced:
                if previous is None:
                    path.unlink(missing_ok=True)
                else:
                    atomic_write(path, previous)
            if stop_attempted and recovery_error is None:
                _launchctl(["bootstrap", domain, str(path)], timeout)
        except (OSError, RuntimeError) as recovery:
            recovery_error = recovery
        if recovery_error is not None:
            raise LaunchAgentRecoveryError(
                f"LaunchAgent replacement failed; previous service recovery remains uncertain ({type(recovery_error).__name__})"
            ) from exc
        raise
    finally:
        candidate.unlink(missing_ok=True)
