#!/usr/bin/env python3
"""Install the launchd jobs that host wat2do on the Mac mini.

Every job runs from ~/wat2do-data/releases/current, which deploy.sh switches, so a
deploy never edits these plists. Run it again after changing a job below; it
replaces each plist and reloads the job. Secrets stay in ~/wat2do-data/config
(mode 0600) and never appear in a plist.

Usage: infra/mac-mini/install.py [job ...]   (no names installs every job)
"""

from __future__ import annotations

import os
import plistlib
import subprocess
import sys
from pathlib import Path

HOME = Path.home()
DATA = HOME / "wat2do-data"
CURRENT = DATA / "releases/current/infra/mac-mini/bin"
LOGS = DATA / "logs"
AGENTS = HOME / "Library/LaunchAgents"
POSTGRES = Path("/opt/homebrew/opt/postgresql@17/bin/postgres")


def service(label: str, arguments: list[str], **extra: object) -> dict[str, object]:
    """A job that runs all the time and comes back whenever it exits."""
    return {
        "Label": label,
        "ProgramArguments": arguments,
        "RunAtLoad": True,
        "KeepAlive": True,
        "ProcessType": "Interactive",
        "StandardOutPath": str(LOGS / f"{label.removeprefix('io.wat2do.')}.log"),
        "StandardErrorPath": str(LOGS / f"{label.removeprefix('io.wat2do.')}.log"),
        **extra,
    }


def timer(label: str, script: str, **schedule: object) -> dict[str, object]:
    """A job that runs a script on a schedule and exits."""
    return {
        "Label": label,
        "ProgramArguments": [str(CURRENT / script)],
        "ProcessType": "Background",
        "StandardOutPath": "/dev/null",
        "StandardErrorPath": str(LOGS / f"{label.removeprefix('io.wat2do.')}.log"),
        **schedule,
    }


JOBS: dict[str, dict[str, object]] = {
    "io.wat2do.postgres": service(
        "io.wat2do.postgres",
        [str(POSTGRES), "-D", str(DATA / "postgres")],
        # Without a locale Postgres refuses to start under launchd ("became multithreaded").
        EnvironmentVariables={"LC_ALL": "en_US.UTF-8", "LANG": "en_US.UTF-8"},
    ),
    "io.wat2do.postgrest": service(
        "io.wat2do.postgrest",
        [str(HOME / ".local/libexec/wat2do/postgrest"), str(DATA / "config/postgrest.conf")],
    ),
    "io.wat2do.caddy": service(
        "io.wat2do.caddy",
        [
            "/opt/homebrew/bin/caddy",
            "run",
            "--config",
            str(DATA / "releases/current/infra/mac-mini/Caddyfile"),
            "--adapter",
            "caddyfile",
        ],
        EnvironmentVariables={
            "WAT2DO_DATA": str(DATA),
            "XDG_DATA_HOME": str(DATA / "caddy"),
            "XDG_CONFIG_HOME": str(DATA / "caddy"),
        },
    ),
    "io.wat2do.api": service("io.wat2do.api", [str(CURRENT / "run-api")]),
    "io.wat2do.web": service("io.wat2do.web", [str(CURRENT / "run-web")]),
    "io.wat2do.event-change-alerts": timer(
        "io.wat2do.event-change-alerts", "event-change-alerts", StartInterval=60
    ),
    "io.wat2do.prune-automate-logs": timer(
        "io.wat2do.prune-automate-logs",
        "prune-automate-logs",
        StartCalendarInterval={"Hour": 4, "Minute": 10},
    ),
    "io.wat2do.scheduled-emails": timer(
        "io.wat2do.scheduled-emails", "scheduled-emails", StartCalendarInterval={"Minute": 17}
    ),
    # The first of each month, a few hours after the old 01:15 UTC GitHub schedule.
    "io.wat2do.poster-payouts": timer(
        "io.wat2do.poster-payouts",
        "poster-payouts",
        StartCalendarInterval={"Day": 1, "Hour": 3, "Minute": 15},
    ),
    "io.wat2do.instagram-account-stats": timer(
        "io.wat2do.instagram-account-stats",
        "instagram-account-stats",
        StartCalendarInterval={"Hour": 6, "Minute": 0},
    ),
}


def install(label: str) -> None:
    path = AGENTS / f"{label}.plist"
    domain = f"gui/{os.getuid()}"
    subprocess.run(["launchctl", "bootout", f"{domain}/{label}"], capture_output=True)
    path.write_bytes(plistlib.dumps(JOBS[label]))
    subprocess.run(["launchctl", "bootstrap", domain, str(path)], check=True)
    print(f"installed {label}")


def main() -> int:
    unknown = [name for name in sys.argv[1:] if name not in JOBS]
    if unknown:
        print(f"unknown jobs: {', '.join(unknown)}; known: {', '.join(JOBS)}", file=sys.stderr)
        return 2
    LOGS.mkdir(parents=True, exist_ok=True)
    for label in sys.argv[1:] or JOBS:
        install(label)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
