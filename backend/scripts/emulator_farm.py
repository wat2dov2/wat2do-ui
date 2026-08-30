#!/usr/bin/env python3
"""Provision, supervise, and dispatch the Instagram notification emulator farm.

Automate keeps Android notification observation active. This script owns the
Android SDK/AVD lifecycle and the scheduled GitHub dispatch cycle. It forwards
only the Instagram processing metadata required by the existing workflow, and
never persists notification bodies, titles, push identifiers, or media metadata.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import plistlib
import re
import shutil
import subprocess
import sys
import time
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Sequence
from urllib.parse import parse_qsl, urlsplit

BACKEND_DIRECTORY = Path(__file__).resolve().parents[1]
if str(BACKEND_DIRECTORY) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIRECTORY))

from core.controlbox import EmulatorFarmNodeControl, controlbox  # noqa: E402
from services.instagram_notifications.browser_digest import (  # noqa: E402
    BrowserDigestError,
    BrowserInstagramDigestResolver,
    DigestResolution,
    action_media_ids,
    merge_action_media_ids,
)

CONTROL = controlbox.emulator_farm
LAUNCH_AGENT_LABEL = "io.wat2do.emulator-farm.check"
LAUNCH_AGENT_FILENAME = f"{LAUNCH_AGENT_LABEL}.plist"
LAUNCH_AGENT_PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"


class FarmError(RuntimeError):
    """Raised when an emulator farm operation cannot complete safely."""


@dataclass(frozen=True)
class FarmPaths:
    sdk_root: Path
    avd_home: Path
    state_directory: Path
    launch_agent_path: Path
    python: Path
    script: Path

    @property
    def adb(self) -> Path:
        return self.sdk_root / "platform-tools" / "adb"

    @property
    def emulator(self) -> Path:
        return self.sdk_root / "emulator" / "emulator"

    @property
    def evidence(self) -> Path:
        return self.state_directory / "notification-evidence.json"

    @property
    def checks(self) -> Path:
        return self.state_directory / "checks.jsonl"

    @property
    def dispatches(self) -> Path:
        return self.state_directory / "dispatch-ledger.json"


@dataclass(frozen=True)
class NotificationEvidence:
    recipient_id: str
    post_time_epoch_seconds: int | None
    push_id: str | None = None
    push_category: str | None = None
    instagram_action: str | None = None
    cache_ent_id: str | None = None
    total_media_count: str | None = None
    notification_title: str | None = None
    notification_text: str | None = None


_INSTAGRAM_ACTION_KEY = "com.instagram.android.igns.logging.ig_action"
_PUSH_CATEGORY_KEY = "com.instagram.android.igns.logging.push_category"
_PUSH_ID_KEY = "com.instagram.android.igns.logging.push_id"
_CACHE_ID_KEY = "cache_ent_id"
_TOTAL_MEDIA_COUNT_KEY = "total_non_mmc_media_count"
_NOTIFICATION_TITLE_KEY = "android.title"
_NOTIFICATION_TEXT_KEY = "android.text"
_DIGEST_CATEGORY = "subscription_daily_digest"


@dataclass(frozen=True)
class NodeStatus:
    name: str
    serial: str
    avd_exists: bool
    device_state: str
    boot_completed: bool
    instagram_installed: bool
    automate_installed: bool
    automate_notification_access: bool
    current_recipient_ids: tuple[str, ...]


def utc_now() -> datetime:
    return datetime.now(UTC)


def default_paths() -> FarmPaths:
    sdk_environment = os.environ.get("ANDROID_SDK_ROOT") or os.environ.get("ANDROID_HOME")
    sdk_root = (
        Path(sdk_environment).expanduser()
        if sdk_environment
        else Path.home() / "Library/Android/sdk"
    )
    avd_environment = os.environ.get("ANDROID_AVD_HOME")
    avd_home = (
        Path(avd_environment).expanduser() if avd_environment else Path.home() / ".android/avd"
    )
    state_base = Path(os.environ.get("XDG_STATE_HOME", Path.home() / ".local/state"))
    python = Path(sys.executable).absolute()
    return FarmPaths(
        sdk_root=sdk_root.resolve(),
        avd_home=avd_home.resolve(),
        state_directory=(state_base / "wat2do/emulator-farm").resolve(),
        launch_agent_path=(Path.home() / "Library/LaunchAgents" / LAUNCH_AGENT_FILENAME),
        python=python,
        script=Path(__file__).resolve(),
    )


def _command(
    arguments: Sequence[str | Path],
    *,
    input_text: str | None = None,
    check: bool = True,
    timeout: float | None = None,
) -> subprocess.CompletedProcess[str]:
    rendered = [str(argument) for argument in arguments]
    try:
        return subprocess.run(
            rendered,
            capture_output=True,
            text=True,
            input=input_text,
            check=check,
            timeout=timeout,
        )
    except FileNotFoundError as exc:
        raise FarmError(f"Required command was not found: {rendered[0]}") from exc
    except subprocess.TimeoutExpired as exc:
        raise FarmError(f"Command timed out: {rendered[0]}") from exc
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or exc.stdout or "unknown error").strip()
        raise FarmError(f"Command failed ({' '.join(rendered[:3])}): {detail}") from exc


def _optional_command(
    arguments: Sequence[str | Path], *, timeout: float | None = None
) -> subprocess.CompletedProcess[str]:
    return _command(arguments, check=False, timeout=timeout)


def _resolve_tool(paths: FarmPaths, name: str) -> Path:
    sdk_path = {
        "adb": paths.adb,
        "emulator": paths.emulator,
    }.get(name)
    if sdk_path and sdk_path.is_file():
        return sdk_path
    discovered = shutil.which(name)
    if discovered:
        return Path(discovered)
    expected = f" or {sdk_path}" if sdk_path else ""
    raise FarmError(f"{name} is not installed or available on PATH{expected}")


def _serial(node: EmulatorFarmNodeControl) -> str:
    return f"emulator-{node.port}"


def _selected_nodes(names: Sequence[str] | None) -> tuple[EmulatorFarmNodeControl, ...]:
    nodes_by_name = {node.name: node for node in CONTROL.nodes}
    if not names:
        return CONTROL.nodes
    unknown = sorted(set(names) - nodes_by_name.keys())
    if unknown:
        raise FarmError(f"Unknown emulator node(s): {', '.join(unknown)}")
    selected = tuple(nodes_by_name[name] for name in names)
    if len(selected) > CONTROL.maximum_running_nodes:
        raise FarmError(f"At most {CONTROL.maximum_running_nodes} nodes may be selected")
    return selected


def _adb_devices(paths: FarmPaths) -> dict[str, str]:
    adb = _resolve_tool(paths, "adb")
    result = _command([adb, "devices"])
    devices: dict[str, str] = {}
    for line in result.stdout.splitlines()[1:]:
        parts = line.split()
        if len(parts) >= 2:
            devices[parts[0]] = parts[1]
    return devices


def _adb(
    paths: FarmPaths,
    node: EmulatorFarmNodeControl,
    arguments: Sequence[str],
    *,
    check: bool = True,
    timeout: float | None = 30,
) -> subprocess.CompletedProcess[str]:
    adb = _resolve_tool(paths, "adb")
    return _command(
        [adb, "-s", _serial(node), *arguments],
        check=check,
        timeout=timeout,
    )


def _package_installed(paths: FarmPaths, node: EmulatorFarmNodeControl, package: str) -> bool:
    result = _adb(paths, node, ["shell", "pm", "path", package], check=False)
    return result.returncode == 0 and result.stdout.strip().startswith("package:")


def _normalize_dumpsys_value(value: str) -> str:
    normalized = value.strip().rstrip("}])").strip()
    if normalized.startswith("String ("):
        normalized = normalized.removeprefix("String (").rstrip(")").strip()
    if len(normalized) >= 2 and normalized[0] == normalized[-1] and normalized[0] in "\"'":
        normalized = normalized[1:-1]
    return normalized.strip()


def _notification_metadata(record: str) -> dict[str, str]:
    metadata: dict[str, str] = {}
    for key in (
        CONTROL.recipient_id_key,
        _PUSH_ID_KEY,
        _PUSH_CATEGORY_KEY,
        _INSTAGRAM_ACTION_KEY,
        _CACHE_ID_KEY,
        _TOTAL_MEDIA_COUNT_KEY,
        _NOTIFICATION_TITLE_KEY,
        _NOTIFICATION_TEXT_KEY,
    ):
        match = re.search(
            rf"{re.escape(key)}\s*(?:=|:)\s*(?P<value>.*?)"
            rf"(?=,\s*[A-Za-z0-9_.:-]+\s*(?:=|:)|"
            rf"\n\s*[A-Za-z0-9_.:-]+\s*(?:=|:)|$)",
            record,
            re.DOTALL,
        )
        if not match:
            continue
        value = _normalize_dumpsys_value(match.group("value"))
        if value:
            metadata[key] = value

    instagram_action = metadata.get(_INSTAGRAM_ACTION_KEY)
    for key in (_CACHE_ID_KEY, _TOTAL_MEDIA_COUNT_KEY):
        action_value = _action_query_metadata_value(instagram_action, key)
        if action_value:
            metadata[key] = action_value
    return metadata


def _action_query_metadata_value(action: str | None, key: str) -> str | None:
    """Return the unambiguous metadata value encoded in an Instagram action."""

    if not action:
        return None
    try:
        query = urlsplit(action).query
    except ValueError:
        return None
    values = {
        value.strip()
        for query_key, value in parse_qsl(query, keep_blank_values=False)
        if query_key == key and value.strip()
    }
    if len(values) != 1:
        return None
    return values.pop()


def parse_notification_evidence(raw: str) -> tuple[NotificationEvidence, ...]:
    """Extract routing and processing metadata from Instagram notification records."""
    records = re.split(r"(?=NotificationRecord[({])", raw)
    evidence: set[
        tuple[
            str,
            int | None,
            str | None,
            str | None,
            str | None,
            str | None,
            str | None,
            str | None,
            str | None,
        ]
    ] = set()
    package_pattern = re.compile(rf"\bpkg={re.escape(CONTROL.instagram_package)}\b")
    post_time_pattern = re.compile(r"\bpostTime=(\d{10,13})\b")

    for record in records:
        if not package_pattern.search(record):
            continue
        metadata = _notification_metadata(record)
        recipient_id = metadata.get(CONTROL.recipient_id_key)
        if not recipient_id or not re.fullmatch(r"[1-9][0-9]{4,31}", recipient_id):
            continue
        post_time_match = post_time_pattern.search(record)
        post_time: int | None = None
        if post_time_match:
            post_time = int(post_time_match.group(1))
            if post_time > 9_999_999_999:
                post_time //= 1000
        evidence.add(
            (
                recipient_id,
                post_time,
                metadata.get(_PUSH_ID_KEY),
                metadata.get(_PUSH_CATEGORY_KEY),
                metadata.get(_INSTAGRAM_ACTION_KEY),
                metadata.get(_CACHE_ID_KEY),
                metadata.get(_TOTAL_MEDIA_COUNT_KEY),
                metadata.get(_NOTIFICATION_TITLE_KEY),
                metadata.get(_NOTIFICATION_TEXT_KEY),
            )
        )

    return tuple(
        NotificationEvidence(
            recipient_id=recipient_id,
            post_time_epoch_seconds=post_time,
            push_id=push_id,
            push_category=push_category,
            instagram_action=instagram_action,
            cache_ent_id=cache_ent_id,
            total_media_count=total_media_count,
            notification_title=notification_title,
            notification_text=notification_text,
        )
        for (
            recipient_id,
            post_time,
            push_id,
            push_category,
            instagram_action,
            cache_ent_id,
            total_media_count,
            notification_title,
            notification_text,
        ) in sorted(
            evidence,
            key=lambda item: (item[0], item[1] or 0, item[2] or ""),
        )
    )


def _current_evidence(
    paths: FarmPaths, node: EmulatorFarmNodeControl
) -> tuple[NotificationEvidence, ...]:
    result = _adb(
        paths,
        node,
        ["shell", "dumpsys", "notification", "--noredact"],
        check=False,
        timeout=45,
    )
    if result.returncode != 0:
        return ()
    return parse_notification_evidence(result.stdout)


def _boot_completed(paths: FarmPaths, node: EmulatorFarmNodeControl) -> bool:
    result = _adb(
        paths,
        node,
        ["shell", "getprop", "sys.boot_completed"],
        check=False,
        timeout=10,
    )
    return result.returncode == 0 and result.stdout.strip() == "1"


def _notification_access_enabled(paths: FarmPaths, node: EmulatorFarmNodeControl) -> bool:
    result = _adb(
        paths,
        node,
        ["shell", "settings", "get", "secure", "enabled_notification_listeners"],
        check=False,
    )
    return result.returncode == 0 and CONTROL.automate_package in result.stdout


def node_status(paths: FarmPaths, node: EmulatorFarmNodeControl) -> NodeStatus:
    devices = _adb_devices(paths)
    state = devices.get(_serial(node), "stopped")
    online = state == "device"
    evidence = _current_evidence(paths, node) if online else ()
    return NodeStatus(
        name=node.name,
        serial=_serial(node),
        avd_exists=(paths.avd_home / f"{node.name}.avd").is_dir(),
        device_state=state,
        boot_completed=online and _boot_completed(paths, node),
        instagram_installed=(online and _package_installed(paths, node, CONTROL.instagram_package)),
        automate_installed=(online and _package_installed(paths, node, CONTROL.automate_package)),
        automate_notification_access=(online and _notification_access_enabled(paths, node)),
        current_recipient_ids=tuple(sorted({item.recipient_id for item in evidence})),
    )


def _sdkmanager(paths: FarmPaths) -> Path:
    local = paths.sdk_root / "cmdline-tools/latest/bin/sdkmanager"
    if local.is_file():
        return local
    return _resolve_tool(paths, "sdkmanager")


def _avdmanager(paths: FarmPaths) -> Path:
    local = paths.sdk_root / "cmdline-tools/latest/bin/avdmanager"
    if local.is_file():
        return local
    return _resolve_tool(paths, "avdmanager")


def _platform_package() -> str:
    parts = CONTROL.system_image.split(";")
    if len(parts) != 4 or not parts[1].startswith("android-"):
        raise FarmError(f"Invalid configured Android system image: {CONTROL.system_image}")
    return f"platforms;{parts[1]}"


def provision(paths: FarmPaths) -> None:
    paths.sdk_root.mkdir(parents=True, exist_ok=True)
    sdkmanager = _sdkmanager(paths)
    print(f"Installing Android packages into {paths.sdk_root}")
    _command(
        [sdkmanager, f"--sdk_root={paths.sdk_root}", "--licenses"],
        input_text="y\n" * 100,
        check=False,
        timeout=600,
    )
    _command(
        [
            sdkmanager,
            f"--sdk_root={paths.sdk_root}",
            "platform-tools",
            "emulator",
            _platform_package(),
            CONTROL.system_image,
        ],
        input_text="y\n" * 100,
        timeout=1800,
    )

    paths.avd_home.mkdir(parents=True, exist_ok=True)
    avdmanager = _avdmanager(paths)
    environment = os.environ.copy()
    environment["ANDROID_SDK_ROOT"] = str(paths.sdk_root)
    environment["ANDROID_HOME"] = str(paths.sdk_root)
    environment["ANDROID_AVD_HOME"] = str(paths.avd_home)
    tools_directory = paths.sdk_root / "cmdline-tools/latest"
    tools_directory.mkdir(parents=True, exist_ok=True)
    avdmanager_options = environment.get("AVDMANAGER_OPTS", "").strip()
    environment["AVDMANAGER_OPTS"] = " ".join(
        part
        for part in (
            avdmanager_options,
            f"-Dcom.android.sdkmanager.toolsdir={tools_directory}",
        )
        if part
    )
    for node in CONTROL.nodes:
        avd_directory = paths.avd_home / f"{node.name}.avd"
        if avd_directory.is_dir():
            print(f"Keeping existing AVD {node.name}")
            continue
        result = subprocess.run(
            [
                str(avdmanager),
                "create",
                "avd",
                "--name",
                node.name,
                "--package",
                CONTROL.system_image,
                "--device",
                CONTROL.device_profile,
            ],
            capture_output=True,
            text=True,
            input="no\n",
            env=environment,
            timeout=180,
        )
        if result.returncode != 0:
            detail = (result.stderr or result.stdout).strip()
            raise FarmError(f"Could not create AVD {node.name}: {detail}")
        _update_avd_configuration(avd_directory / "config.ini")
        print(f"Created AVD {node.name}")


def _update_avd_configuration(path: Path) -> None:
    values: dict[str, str] = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            if "=" in line:
                key, value = line.split("=", 1)
                values[key] = value
    values.update(
        {
            "PlayStore.enabled": "true",
            "hw.cpu.ncore": str(CONTROL.cpu_cores_per_node),
            "hw.ramSize": str(CONTROL.memory_megabytes_per_node),
        }
    )
    path.write_text(
        "".join(f"{key}={values[key]}\n" for key in sorted(values)),
        encoding="utf-8",
    )


def _running_emulator_count(paths: FarmPaths) -> int:
    return sum(serial.startswith("emulator-") for serial in _adb_devices(paths))


def start_nodes(
    paths: FarmPaths,
    nodes: Sequence[EmulatorFarmNodeControl],
    *,
    headless: bool,
) -> None:
    emulator = _resolve_tool(paths, "emulator")
    adb = _resolve_tool(paths, "adb")
    _command([adb, "start-server"])
    paths.state_directory.mkdir(parents=True, exist_ok=True)
    devices = _adb_devices(paths)
    starting = [node for node in nodes if devices.get(_serial(node)) != "device"]
    if _running_emulator_count(paths) + len(starting) > CONTROL.maximum_running_nodes:
        raise FarmError(
            f"Starting these nodes would exceed the {CONTROL.maximum_running_nodes}-emulator cap"
        )

    environment = os.environ.copy()
    environment["ANDROID_SDK_ROOT"] = str(paths.sdk_root)
    environment["ANDROID_HOME"] = str(paths.sdk_root)
    environment["ANDROID_AVD_HOME"] = str(paths.avd_home)
    for node in starting:
        if not (paths.avd_home / f"{node.name}.avd").is_dir():
            raise FarmError(f"AVD {node.name} is missing; run provision first")
        log_path = paths.state_directory / f"{node.name}.emulator.log"
        log_handle = log_path.open("ab")
        emulator_arguments = [
            str(emulator),
            "-avd",
            node.name,
            "-port",
            str(node.port),
            "-no-audio",
            "-no-boot-anim",
            "-no-snapshot-load",
            "-no-snapshot-save",
            "-gpu",
            "swiftshader_indirect",
            "-memory",
            str(CONTROL.memory_megabytes_per_node),
            "-cores",
            str(CONTROL.cpu_cores_per_node),
        ]
        if headless:
            emulator_arguments.append("-no-window")
        process = subprocess.Popen(
            emulator_arguments,
            stdin=subprocess.DEVNULL,
            stdout=log_handle,
            stderr=subprocess.STDOUT,
            env=environment,
            start_new_session=True,
        )
        log_handle.close()
        (paths.state_directory / f"{node.name}.pid").write_text(
            f"{process.pid}\n", encoding="utf-8"
        )
        print(f"Started {node.name} as {_serial(node)} (PID {process.pid})")

    for node in nodes:
        _wait_for_boot(paths, node)


def _wait_for_boot(paths: FarmPaths, node: EmulatorFarmNodeControl) -> None:
    deadline = time.monotonic() + CONTROL.boot_timeout_seconds
    while time.monotonic() < deadline:
        devices = _adb_devices(paths)
        if devices.get(_serial(node)) == "device" and _boot_completed(paths, node):
            print(f"{node.name} booted")
            return
        time.sleep(2)
    raise FarmError(f"{node.name} did not boot within {CONTROL.boot_timeout_seconds} seconds")


def stop_nodes(paths: FarmPaths, nodes: Sequence[EmulatorFarmNodeControl]) -> None:
    devices = _adb_devices(paths)
    for node in nodes:
        if _serial(node) not in devices:
            print(f"{node.name} is already stopped")
            continue
        _adb(paths, node, ["emu", "kill"], check=False)
        print(f"Stopped {node.name}")


def install_apks(
    paths: FarmPaths,
    nodes: Sequence[EmulatorFarmNodeControl],
    instagram_apk: Path | None,
    automate_apk: Path | None,
) -> None:
    apks = tuple(
        (label, path)
        for label, path in (("Instagram", instagram_apk), ("Automate", automate_apk))
        if path is not None
    )
    if not apks:
        raise FarmError("Provide --instagram-apk, --automate-apk, or both")
    for label, path in apks:
        if not path or not path.is_file():
            raise FarmError(f"{label} APK was not found: {path}")
    for node in nodes:
        for label, path in apks:
            _adb(paths, node, ["install", "-r", str(path)], timeout=300)
            print(f"Installed {label} on {node.name}")


def _automate_listener_components(
    paths: FarmPaths, node: EmulatorFarmNodeControl
) -> tuple[str, ...]:
    result = _adb(
        paths,
        node,
        [
            "shell",
            "cmd",
            "package",
            "query-services",
            "--brief",
            "-a",
            "android.service.notification.NotificationListenerService",
            CONTROL.automate_package,
        ],
        check=False,
    )
    pattern = re.compile(rf"\b{re.escape(CONTROL.automate_package)}/[A-Za-z0-9_.$]+\b")
    return tuple(sorted(set(pattern.findall(result.stdout))))


def configure_nodes(paths: FarmPaths, nodes: Sequence[EmulatorFarmNodeControl]) -> None:
    animation_keys = (
        "window_animation_scale",
        "transition_animation_scale",
        "animator_duration_scale",
    )
    for node in nodes:
        _adb(
            paths,
            node,
            ["shell", "settings", "put", "global", "stay_on_while_plugged_in", "7"],
        )
        for key in animation_keys:
            _adb(paths, node, ["shell", "settings", "put", "global", key, "0"])
        for package in (CONTROL.instagram_package, CONTROL.automate_package):
            if not _package_installed(paths, node, package):
                continue
            _adb(
                paths,
                node,
                ["shell", "dumpsys", "deviceidle", "whitelist", f"+{package}"],
                check=False,
            )
            _adb(
                paths,
                node,
                ["shell", "pm", "grant", package, "android.permission.POST_NOTIFICATIONS"],
                check=False,
            )
        components = _automate_listener_components(paths, node)
        for component in components:
            _adb(
                paths,
                node,
                ["shell", "cmd", "notification", "allow_listener", component],
                check=False,
            )
        print(
            f"Configured {node.name}; Automate notification listener components: "
            f"{', '.join(components) if components else 'not installed or not declared'}"
        )


def _read_evidence(paths: FarmPaths) -> dict[str, dict[str, str]]:
    try:
        payload = json.loads(paths.evidence.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def _write_json_atomic(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f"{path.suffix}.tmp")
    temporary.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temporary.replace(path)


def _read_dispatch_ledger(paths: FarmPaths) -> dict[str, str]:
    try:
        payload = json.loads(paths.dispatches.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}
    if not isinstance(payload, dict):
        return {}
    return {
        fingerprint: timestamp
        for fingerprint, timestamp in payload.items()
        if isinstance(fingerprint, str) and isinstance(timestamp, str)
    }


def _notification_dictionary(item: NotificationEvidence) -> dict[str, str] | None:
    if not item.push_id or not item.push_category or not item.instagram_action:
        return None
    notification = {
        CONTROL.recipient_id_key: item.recipient_id,
        _PUSH_ID_KEY: item.push_id,
        _PUSH_CATEGORY_KEY: item.push_category,
        _INSTAGRAM_ACTION_KEY: item.instagram_action,
    }
    if item.cache_ent_id:
        notification[_CACHE_ID_KEY] = item.cache_ent_id
    if item.total_media_count:
        notification[_TOTAL_MEDIA_COUNT_KEY] = item.total_media_count
    return notification


def _notification_fingerprint(item: NotificationEvidence) -> str | None:
    if not item.push_id:
        return None
    return hashlib.sha256(item.push_id.encode("utf-8")).hexdigest()


def _dispatch_notification(github: Path, notification: dict[str, str]) -> None:
    payload = {
        "event_type": CONTROL.github_event_type,
        "client_payload": {
            "intended_recipient_id": notification[CONTROL.recipient_id_key],
            "notification_dict": notification,
        },
    }
    _command(
        [
            github,
            "api",
            "--method",
            "POST",
            f"repos/{CONTROL.github_repository}/dispatches",
            "--input",
            "-",
        ],
        input_text=json.dumps(payload),
        timeout=30,
    )


def _expand_digest_notification(
    notification: dict[str, str],
    resolver: BrowserInstagramDigestResolver,
) -> tuple[dict[str, str], DigestResolution | None]:
    if notification[_PUSH_CATEGORY_KEY] != _DIGEST_CATEGORY:
        return notification, None

    cache_ent_id = notification.get(_CACHE_ID_KEY)
    if not cache_ent_id:
        return notification, None
    instagram_action = notification[_INSTAGRAM_ACTION_KEY]
    explicit_media_ids = action_media_ids(instagram_action)
    total_media_count_text = notification.get(_TOTAL_MEDIA_COUNT_KEY)
    total_media_count: int | None = None
    if total_media_count_text is not None:
        if not total_media_count_text.isascii() or not total_media_count_text.isdigit():
            raise BrowserDigestError("Instagram digest media count is invalid")
        total_media_count = int(total_media_count_text)
        if len(explicit_media_ids) >= total_media_count:
            return notification, None

    resolution = resolver.resolve(
        notification[CONTROL.recipient_id_key],
        cache_ent_id,
    )
    expanded_action = merge_action_media_ids(instagram_action, resolution.media_ids)
    expanded_media_ids = action_media_ids(expanded_action)
    if total_media_count is not None and len(expanded_media_ids) != total_media_count:
        raise BrowserDigestError(
            "Instagram digest did not resolve the advertised number of media IDs"
        )
    expanded = dict(notification)
    expanded[_INSTAGRAM_ACTION_KEY] = expanded_action
    return expanded, resolution


def dispatch_notifications(
    paths: FarmPaths,
    nodes: Sequence[EmulatorFarmNodeControl],
    evidence_by_node: dict[str, tuple[NotificationEvidence, ...]],
) -> dict[str, Any]:
    now = utc_now()
    candidates: dict[str, tuple[NotificationEvidence, dict[str, str]]] = {}
    incomplete_recipient_ids: set[str] = set()
    stale_recipient_ids: set[str] = set()
    duplicate_count = 0

    for node in nodes:
        for item in evidence_by_node.get(node.name, ()):
            if item.post_time_epoch_seconds is not None:
                age = now.timestamp() - item.post_time_epoch_seconds
                if age < 0 or age > CONTROL.notification_evidence_max_age_seconds:
                    stale_recipient_ids.add(item.recipient_id)
                    continue
            notification = _notification_dictionary(item)
            fingerprint = _notification_fingerprint(item)
            if notification is None or fingerprint is None:
                incomplete_recipient_ids.add(item.recipient_id)
                continue
            existing = candidates.get(fingerprint)
            if existing:
                duplicate_count += 1
                if existing[1] != notification:
                    raise FarmError("Conflicting Instagram metadata shared one push identifier")
                continue
            candidates[fingerprint] = (item, notification)

    ledger = _read_dispatch_ledger(paths)
    for fingerprint, timestamp_text in tuple(ledger.items()):
        try:
            timestamp = datetime.fromisoformat(timestamp_text)
        except ValueError:
            del ledger[fingerprint]
            continue
        if timestamp.tzinfo is None:
            timestamp = timestamp.replace(tzinfo=UTC)
        if (now - timestamp).total_seconds() > CONTROL.notification_evidence_max_age_seconds:
            del ledger[fingerprint]

    dispatched_recipient_ids: set[str] = set()
    dispatched_count = 0
    already_dispatched_count = 0
    github: Path | None = None
    for fingerprint, (item, notification) in candidates.items():
        if fingerprint in ledger:
            already_dispatched_count += 1
            continue
        github = github or _resolve_tool(paths, "gh")
        _dispatch_notification(github, notification)
        ledger[fingerprint] = now.isoformat()
        _write_json_atomic(paths.dispatches, ledger)
        dispatched_recipient_ids.add(item.recipient_id)
        dispatched_count += 1

    return {
        "dispatched_count": dispatched_count,
        "dispatched_recipient_ids": sorted(dispatched_recipient_ids),
        "already_dispatched_count": already_dispatched_count,
        "duplicate_observation_count": duplicate_count,
        "incomplete_recipient_ids": sorted(incomplete_recipient_ids),
        "stale_recipient_ids": sorted(stale_recipient_ids),
    }


def _current_evidence_by_node(
    paths: FarmPaths,
    nodes: Sequence[EmulatorFarmNodeControl],
) -> dict[str, tuple[NotificationEvidence, ...]]:
    devices = _adb_devices(paths)
    return {
        node.name: (
            _current_evidence(paths, node) if devices.get(_serial(node)) == "device" else ()
        )
        for node in nodes
    }


def check_notifications(
    paths: FarmPaths,
    nodes: Sequence[EmulatorFarmNodeControl],
    *,
    evidence_by_node: dict[str, tuple[NotificationEvidence, ...]] | None = None,
) -> dict[str, Any]:
    now = utc_now()
    saved = _read_evidence(paths)
    selected_node_names = {node.name for node in nodes}
    saved = {name: evidence for name, evidence in saved.items() if name in selected_node_names}
    result_nodes: list[dict[str, Any]] = []
    effective_ids_by_node: dict[str, set[str]] = {}
    devices = _adb_devices(paths)

    for node in nodes:
        online = devices.get(_serial(node)) == "device"
        live = (
            evidence_by_node.get(node.name, ())
            if evidence_by_node is not None
            else (_current_evidence(paths, node) if online else ())
        )
        node_saved = saved.setdefault(node.name, {})
        for item in live:
            timestamp = (
                datetime.fromtimestamp(item.post_time_epoch_seconds, UTC)
                if item.post_time_epoch_seconds
                else now
            )
            node_saved[item.recipient_id] = timestamp.isoformat()

        effective: set[str] = set()
        for recipient_id, timestamp_text in tuple(node_saved.items()):
            try:
                timestamp = datetime.fromisoformat(timestamp_text)
            except (TypeError, ValueError):
                del node_saved[recipient_id]
                continue
            if timestamp.tzinfo is None:
                timestamp = timestamp.replace(tzinfo=UTC)
            age = (now - timestamp).total_seconds()
            if 0 <= age <= CONTROL.notification_evidence_max_age_seconds:
                effective.add(recipient_id)
            else:
                del node_saved[recipient_id]

        effective_ids_by_node[node.name] = effective
        result_nodes.append(
            {
                "name": node.name,
                "serial": _serial(node),
                "online": online,
                "recipient_ids": sorted(effective),
                "recipient_capacity": CONTROL.accounts_per_node,
                "within_capacity": len(effective) <= CONTROL.accounts_per_node,
            }
        )

    recipient_sets = list(effective_ids_by_node.values())
    within_capacity = all(len(ids) <= CONTROL.accounts_per_node for ids in recipient_sets)
    payload = {
        "checked_at": now.isoformat(),
        "within_recipient_capacity": within_capacity,
        "nodes": result_nodes,
    }
    _write_json_atomic(paths.evidence, saved)
    paths.checks.parent.mkdir(parents=True, exist_ok=True)
    with paths.checks.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, sort_keys=True) + "\n")
    return payload


def launch_agent_payload(paths: FarmPaths) -> dict[str, Any]:
    return {
        "Label": LAUNCH_AGENT_LABEL,
        "ProgramArguments": [str(paths.python), str(paths.script), "run-cycle", "--json"],
        "WorkingDirectory": str(BACKEND_DIRECTORY),
        "EnvironmentVariables": {
            "ANDROID_SDK_ROOT": str(paths.sdk_root),
            "ANDROID_HOME": str(paths.sdk_root),
            "ANDROID_AVD_HOME": str(paths.avd_home),
            "PATH": LAUNCH_AGENT_PATH,
        },
        "RunAtLoad": True,
        "StartInterval": CONTROL.check_interval_seconds,
        "ProcessType": "Background",
        "StandardOutPath": str(paths.state_directory / "scheduler.stdout.log"),
        "StandardErrorPath": str(paths.state_directory / "scheduler.stderr.log"),
    }


def install_schedule(paths: FarmPaths) -> None:
    paths.launch_agent_path.parent.mkdir(parents=True, exist_ok=True)
    paths.state_directory.mkdir(parents=True, exist_ok=True)
    paths.launch_agent_path.write_bytes(plistlib.dumps(launch_agent_payload(paths), sort_keys=True))
    domain = f"gui/{os.getuid()}"
    _optional_command(["launchctl", "bootout", domain, str(paths.launch_agent_path)])
    _command(["launchctl", "bootstrap", domain, str(paths.launch_agent_path)])
    _command(["launchctl", "enable", f"{domain}/{LAUNCH_AGENT_LABEL}"])
    print(f"Installed {LAUNCH_AGENT_LABEL} with a {CONTROL.check_interval_seconds}-second interval")


def doctor(paths: FarmPaths) -> dict[str, Any]:
    tool_status: dict[str, str | None] = {}
    for name in ("sdkmanager", "avdmanager", "adb", "emulator", "gh"):
        try:
            tool_status[name] = str(_resolve_tool(paths, name))
        except FarmError:
            tool_status[name] = None
    nodes: list[dict[str, Any]] = []
    if tool_status["adb"]:
        nodes = [asdict(node_status(paths, node)) for node in CONTROL.nodes]
    return {
        "sdk_root": str(paths.sdk_root),
        "avd_home": str(paths.avd_home),
        "state_directory": str(paths.state_directory),
        "launch_agent_path": str(paths.launch_agent_path),
        "maximum_running_nodes": CONTROL.maximum_running_nodes,
        "accounts_per_node": CONTROL.accounts_per_node,
        "tools": tool_status,
        "nodes": nodes,
    }


def visible_notifications(
    evidence_by_node: dict[str, tuple[NotificationEvidence, ...]],
    *,
    observed_at: str,
) -> list[dict[str, str | int | None]]:
    """Return parsed metadata for an explicitly requested terminal view."""
    return [
        {
            "node": node_name,
            "observed_at": observed_at,
            "recipient_id": item.recipient_id,
            "post_time_epoch_seconds": item.post_time_epoch_seconds,
            "push_id": item.push_id,
            "push_category": item.push_category,
            "instagram_action": item.instagram_action,
            "cache_ent_id": item.cache_ent_id,
            "total_media_count": item.total_media_count,
            "notification_title": item.notification_title,
            "notification_text": item.notification_text,
        }
        for node_name, items in evidence_by_node.items()
        for item in items
    ]


def run_cycle(
    paths: FarmPaths,
    *,
    show_notifications: bool = False,
) -> dict[str, Any]:
    nodes = CONTROL.nodes
    start_nodes(paths, nodes, headless=CONTROL.run_headlessly)
    configure_nodes(paths, nodes)
    evidence_by_node = _current_evidence_by_node(paths, nodes)
    payload = check_notifications(paths, nodes, evidence_by_node=evidence_by_node)
    payload["dispatch"] = dispatch_notifications(paths, nodes, evidence_by_node)
    if show_notifications:
        payload["observed_notifications"] = visible_notifications(
            evidence_by_node,
            observed_at=payload["checked_at"],
        )
    statuses = [asdict(node_status(paths, node)) for node in nodes]
    payload["operational"] = all(
        status["boot_completed"]
        and status["instagram_installed"]
        and status["automate_installed"]
        and status["automate_notification_access"]
        for status in statuses
    )
    payload["node_statuses"] = statuses
    return payload


def _observation_key(node_name: str, item: NotificationEvidence) -> tuple[object, ...]:
    """Identify one in-memory Android notification observation without persisting it."""

    return (
        node_name,
        item.recipient_id,
        item.post_time_epoch_seconds,
        item.push_id,
        item.push_category,
        item.instagram_action,
    )


def monitor(paths: FarmPaths) -> None:
    """Poll active Android notifications at the configured live-monitor interval."""

    nodes = CONTROL.nodes
    start_nodes(paths, nodes, headless=CONTROL.run_headlessly)
    configure_nodes(paths, nodes)
    observed_keys: set[tuple[object, ...]] = set()

    try:
        while True:
            checked_at = utc_now().isoformat()
            evidence_by_node = _current_evidence_by_node(paths, nodes)
            unseen_by_node = {
                node_name: tuple(
                    item
                    for item in evidence
                    if _observation_key(node_name, item) not in observed_keys
                )
                for node_name, evidence in evidence_by_node.items()
            }
            for node_name, evidence in unseen_by_node.items():
                observed_keys.update(_observation_key(node_name, item) for item in evidence)

            dispatch = dispatch_notifications(paths, nodes, evidence_by_node)
            observed_notifications = visible_notifications(unseen_by_node, observed_at=checked_at)
            if observed_notifications or dispatch["dispatched_count"]:
                _print_payload(
                    {
                        "checked_at": checked_at,
                        "observed_notifications": observed_notifications,
                        "dispatch": dispatch,
                    },
                    True,
                )
            time.sleep(CONTROL.live_monitor_interval_seconds)
    except KeyboardInterrupt:
        return


def resolve_digest(
    *,
    recipient_id: str,
    cache_ent_id: str,
    instagram_action: str,
    total_media_count: int | None,
) -> dict[str, Any]:
    """Run the same serialized browser resolver without dispatching to GitHub."""

    notification = {
        CONTROL.recipient_id_key: recipient_id,
        _PUSH_ID_KEY: "manual-digest-resolution",
        _PUSH_CATEGORY_KEY: _DIGEST_CATEGORY,
        _INSTAGRAM_ACTION_KEY: instagram_action,
        _CACHE_ID_KEY: cache_ent_id,
    }
    if total_media_count is not None:
        notification[_TOTAL_MEDIA_COUNT_KEY] = str(total_media_count)
    expanded, resolution = _expand_digest_notification(
        notification,
        BrowserInstagramDigestResolver(),
    )
    return {
        "account_username": resolution.account_username if resolution else None,
        "cache_ent_id": cache_ent_id,
        "page_count": resolution.page_count if resolution else 0,
        "media_ids": list(action_media_ids(expanded[_INSTAGRAM_ACTION_KEY])),
        "instagram_action": expanded[_INSTAGRAM_ACTION_KEY],
    }


def _print_payload(payload: Any, as_json: bool) -> None:
    if as_json:
        print(json.dumps(payload, indent=2, sort_keys=True))
        return
    if isinstance(payload, list):
        for item in payload:
            print(
                f"{item['name']}: {item['device_state']}, booted={item['boot_completed']}, "
                f"instagram={item['instagram_installed']}, automate={item['automate_installed']}, "
                f"notification_access={item['automate_notification_access']}, "
                f"recipient_ids={','.join(item['current_recipient_ids']) or 'none'}"
            )
        return
    print(json.dumps(payload, indent=2, sort_keys=True))


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("doctor", help="Report host, SDK, AVD, and package readiness")
    subparsers.add_parser("provision", help="Install SDK packages and create configured AVDs")

    for command, help_text in (
        ("start", "Start selected nodes and wait for boot"),
        ("stop", "Stop selected managed nodes"),
        ("configure", "Apply persistent ADB settings and notification access"),
        ("status", "Show node status"),
        ("check", "Check safe Instagram recipient routing evidence"),
    ):
        child = subparsers.add_parser(command, help=help_text)
        child.add_argument("--node", action="append", choices=[node.name for node in CONTROL.nodes])
        if command in {"status", "check"}:
            child.add_argument("--json", action="store_true")

    install = subparsers.add_parser("install-apks", help="Install supplied APKs on selected nodes")
    install.add_argument("--node", action="append", choices=[node.name for node in CONTROL.nodes])
    install.add_argument("--instagram-apk", type=Path)
    install.add_argument("--automate-apk", type=Path)

    subparsers.add_parser("install-schedule", help="Install the 30-minute macOS LaunchAgent")
    cycle = subparsers.add_parser("run-cycle", help="Start, configure, and check all nodes")
    cycle.add_argument("--json", action="store_true")
    cycle.add_argument(
        "--show-notifications",
        action="store_true",
        help="Print parsed Instagram notification metadata, including CacheEntID",
    )
    subparsers.add_parser(
        "monitor",
        help="Poll active Instagram notifications every configured live-monitor interval",
    )
    digest = subparsers.add_parser(
        "resolve-digest",
        help="Resolve one CacheEntID through the existing Brave Instagram tab",
    )
    digest.add_argument("--recipient-id", required=True)
    digest.add_argument("--cache-ent-id", required=True)
    digest.add_argument("--instagram-action", required=True)
    digest.add_argument("--total-media-count", type=int)
    return parser


def main() -> int:
    arguments = _parser().parse_args()
    paths = default_paths()
    try:
        if arguments.command == "doctor":
            _print_payload(doctor(paths), True)
        elif arguments.command == "provision":
            provision(paths)
        elif arguments.command == "start":
            start_nodes(
                paths,
                _selected_nodes(arguments.node),
                headless=CONTROL.run_headlessly,
            )
        elif arguments.command == "stop":
            stop_nodes(paths, _selected_nodes(arguments.node))
        elif arguments.command == "configure":
            configure_nodes(paths, _selected_nodes(arguments.node))
        elif arguments.command == "status":
            nodes = [asdict(node_status(paths, node)) for node in _selected_nodes(arguments.node)]
            _print_payload(nodes, arguments.json)
        elif arguments.command == "install-apks":
            install_apks(
                paths,
                _selected_nodes(arguments.node),
                arguments.instagram_apk,
                arguments.automate_apk,
            )
        elif arguments.command == "check":
            payload = check_notifications(paths, _selected_nodes(arguments.node))
            _print_payload(payload, arguments.json)
        elif arguments.command == "install-schedule":
            install_schedule(paths)
        elif arguments.command == "run-cycle":
            payload = run_cycle(
                paths,
                show_notifications=arguments.show_notifications,
            )
            _print_payload(payload, arguments.json)
            if not payload["operational"]:
                return 1
        elif arguments.command == "monitor":
            monitor(paths)
        elif arguments.command == "resolve-digest":
            _print_payload(
                resolve_digest(
                    recipient_id=arguments.recipient_id,
                    cache_ent_id=arguments.cache_ent_id,
                    instagram_action=arguments.instagram_action,
                    total_media_count=arguments.total_media_count,
                ),
                True,
            )
        else:
            raise FarmError(f"Unsupported command: {arguments.command}")
    except (BrowserDigestError, FarmError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
