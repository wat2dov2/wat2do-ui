#!/usr/bin/env python3
"""Bound notification dependency storage before setup and after every attempt.

This uses only the standard library so disk recovery works before dependencies
are installed. Application controlbox validation covers the checked-in settings.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

CONTROL_PATH = Path(__file__).resolve().parents[1] / "controlbox/notification_workflow.json"
MIB = 1024 * 1024


def existing_directory(path: Path) -> Path:
    while not path.exists() and path != path.parent:
        path = path.parent
    return path


def has_symlink_ancestor(path: Path) -> bool:
    return any(directory.is_symlink() for directory in (path, *path.parents))


def available_mb(path: Path) -> int:
    return shutil.disk_usage(existing_directory(path)).free // MIB


def remaining_seconds(deadline: float) -> float:
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise TimeoutError("Notification cache maintenance deadline exceeded")
    return remaining


def cached_uv(controls: dict) -> str | None:
    architecture = {"ARM64": "aarch64", "X64": "x86_64"}.get(os.environ.get("RUNNER_ARCH"))
    tool_cache = os.environ.get("RUNNER_TOOL_CACHE")
    if architecture and tool_cache:
        directory = Path(tool_cache) / "uv" / controls["uv_version"]
        executable = directory / architecture / "uv"
        if (directory / f"{architecture}.complete").is_file() and os.access(executable, os.X_OK):
            return str(executable)
    return shutil.which("uv")


def uv_command(executable: str, arguments: list[str], deadline: float) -> str:
    remaining = remaining_seconds(deadline)
    result = subprocess.run(
        [executable, "cache", *arguments],
        env={**os.environ, "UV_LOCK_TIMEOUT": str(math.ceil(remaining))},
        stdout=subprocess.PIPE if arguments[0] == "size" else subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=True,
        text=True,
        timeout=remaining,
    )
    return result.stdout or ""


def environment_uses_cache_links(runtime: Path, cache: Path, deadline: float) -> bool:
    """Cache removal must not strand environments created with symlink mode."""
    if not runtime.exists():
        return False
    for owner in runtime.iterdir():
        if not re.fullmatch(r"[a-f0-9]{64}", owner.name):
            continue
        environment = owner / "venv-3.12"
        if owner.is_symlink() or environment.is_symlink():
            return True
        if not environment.exists():
            continue

        def unreadable(error: OSError) -> None:
            raise error

        for directory, subdirectories, filenames in os.walk(environment, onerror=unreadable):
            remaining_seconds(deadline)
            for name in subdirectories + filenames:
                remaining_seconds(deadline)
                path = Path(directory) / name
                if path.is_symlink():
                    target = path.resolve()
                    if target.is_relative_to(cache) or (
                        path.is_dir() and not target.is_relative_to(environment.resolve())
                    ):
                        return True
    return False


def owned_tool_root() -> Path | None:
    """Only a registered runner's exclusive tool directory is ours to trim."""
    if (
        os.environ.get("RUNNER_ENVIRONMENT") != "self-hosted"
        or os.environ.get("GITHUB_ACTIONS") != "true"
    ):
        return None
    tool_cache = Path(os.environ["RUNNER_TOOL_CACHE"])
    runner = tool_cache.parent.parent
    registration = runner / ".runner"
    if has_symlink_ancestor(tool_cache) or registration.is_symlink():
        return None
    try:
        settings = json.loads(registration.read_text(encoding="utf-8-sig"))
        work = Path(settings["workFolder"])
        if (
            settings["agentName"] != os.environ["NOTIFICATION_RUNNER_NAME"]
            or work.is_absolute()
            or len(work.parts) != 1
            or work.name in {".", ".."}
            or (runner / work / "_tool").resolve() != tool_cache.resolve()
        ):
            return None
    except (OSError, ValueError, KeyError, TypeError):
        return None
    root = tool_cache / "uv"
    return root if root.is_dir() and not root.is_symlink() else None


def complete_tool_version(path: Path) -> bool:
    if path.is_symlink() or not path.is_dir() or not re.fullmatch(r"\d+\.\d+\.\d+", path.name):
        return False
    architectures = {"aarch64", "x86_64"}
    entries = set(child.name for child in path.iterdir())
    present = entries & architectures
    if not present or entries != present | {f"{arch}.complete" for arch in present}:
        return False
    for architecture in present:
        directory = path / architecture
        marker = path / f"{architecture}.complete"
        if directory.is_symlink() or marker.is_symlink() or not marker.is_file():
            return False
        binaries = list(directory.iterdir())
        if {binary.name for binary in binaries} != {"uv", "uvx"} or any(
            binary.is_symlink() or not binary.is_file() for binary in binaries
        ):
            return False
    return True


def prune_tool_versions(controls: dict, executable: str | None, deadline: float) -> None:
    root = owned_tool_root()
    inspector = shutil.which("lsof")
    if root is None or inspector is None:
        return
    versions = [directory for directory in root.iterdir() if complete_tool_version(directory)]
    versions.sort(key=lambda directory: tuple(map(int, directory.name.split("."))), reverse=True)
    keep = {controls["uv_version"]}
    for directory in versions:
        if len(keep) < controls["uv_tool_versions_to_keep"]:
            keep.add(directory.name)
    if executable and Path(executable).resolve().is_relative_to(root.resolve()):
        keep.add(Path(executable).resolve().relative_to(root.resolve()).parts[0])
    # One runner slot cannot start another job during this job's maintenance.
    # Independently invoked uv processes still keep their open tool versions.
    result = subprocess.run(
        [inspector, "-Fn", "+D", str(root)],
        capture_output=True,
        text=True,
        check=False,
        timeout=remaining_seconds(deadline),
    )
    if result.returncode not in {0, 1} or result.stderr:
        return
    for line in result.stdout.splitlines():
        if line.startswith("n"):
            path = Path(line[1:])
            if path.is_relative_to(root):
                parts = path.relative_to(root).parts
                if parts:
                    keep.add(parts[0])
    removed = 0
    for directory in versions:
        remaining_seconds(deadline)
        if directory.name not in keep and complete_tool_version(directory):
            subprocess.run(
                [
                    sys.executable,
                    "-c",
                    "import shutil,sys; shutil.rmtree(sys.argv[1])",
                    str(directory),
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=True,
                timeout=remaining_seconds(deadline),
            )
            removed += 1
    if removed:
        print(f"Notification tooling maintenance removed {removed} obsolete uv versions.")


def maintain(controls: dict) -> None:
    deadline = time.monotonic() + controls["cache_cleanup_timeout_seconds"]
    try:
        runtime = Path(os.environ["NOTIFICATION_RUNTIME_ROOT"])
        cache = Path(os.environ["UV_CACHE_DIR"])
        if has_symlink_ancestor(cache) or cache.absolute() != (runtime / "uv-cache").absolute():
            raise ValueError("Notification cache ownership is invalid")
        executable = cached_uv(controls)
        prune_tool_versions(controls, executable, deadline)
        if executable is None:
            print("::warning::Notification dependency cache cleanup deferred: uv is unavailable.")
            return
        if environment_uses_cache_links(runtime, cache.resolve(), deadline):
            print(
                "::warning::Notification cache cleanup deferred: an installed environment uses cache links."
            )
            return
        # Native uv commands own the shared cache lock. Never remove cache files
        # directly or force through another runner's active installation.
        uv_command(executable, ["prune", "--ci"], deadline)
        size = int(uv_command(executable, ["size", "--output-format", "machine"], deadline).strip())
        if (
            size > controls["cache_max_mb"] * MIB
            or available_mb(cache) < controls["cleanup_free_disk_mb"]
        ):
            uv_command(executable, ["clean"], deadline)
            print("Notification dependency cache cleared under its native lock.")
        print("Notification dependency cache maintenance completed.")
    except (OSError, ValueError, KeyError, RuntimeError, subprocess.SubprocessError):
        # A committed notification remains successful even if maintenance fails.
        # Never print exception messages, private paths, or subprocess output.
        print(
            "::warning::Notification storage maintenance deferred; inspect active installs or cache access."
        )


def prepare(controls: dict) -> None:
    maintain(controls)
    owner = hashlib.sha256(os.environ["NOTIFICATION_RUNNER_NAME"].encode()).hexdigest()
    venv = Path(os.environ["NOTIFICATION_RUNTIME_ROOT"]) / owner / "venv-3.12"
    for label, path in (
        ("checkout", Path.cwd()),
        ("dependency cache", Path(os.environ["UV_CACHE_DIR"])),
        ("Python runtime", venv),
        ("temporary files", Path(os.environ["TMPDIR"])),
    ):
        try:
            free = available_mb(path)
        except OSError:
            raise SystemExit(
                f"::error::Cannot check disk capacity for {label}; repair runner filesystem access and rerun this notification."
            ) from None
        if free < controls["minimum_free_disk_mb"]:
            raise SystemExit(
                f"::error::Insufficient disk space for {label}: {free} MiB free after bounded maintenance; need {controls['minimum_free_disk_mb']} MiB. Free runner disk space and rerun this notification; its media has not been processed."
            )
        print(f"Dependency setup capacity: {label} has {free} MiB free.")
    with open(os.environ["GITHUB_ENV"], "a") as output:
        output.write(f"NOTIFICATION_VENV={venv}\n")
        output.write("UV_LINK_MODE=copy\n")
        output.write(f"UV_HTTP_TIMEOUT={controls['http_timeout_seconds']}\n")
        output.write(f"UV_HTTP_RETRIES={controls['http_retries']}\n")
    with open(os.environ["GITHUB_OUTPUT"], "a") as output:
        for name in (
            "uv_version",
            "setup_timeout_minutes",
            "install_timeout_minutes",
            "process_timeout_minutes",
        ):
            output.write(f"{name}={controls[name]}\n")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("prepare", "maintain"))
    arguments = parser.parse_args()
    controls = json.loads(CONTROL_PATH.read_text())
    {"prepare": prepare, "maintain": maintain}[arguments.operation](controls)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
