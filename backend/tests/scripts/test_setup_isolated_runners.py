import hashlib
import json
import os
import plistlib
import subprocess
import tarfile
from pathlib import Path

import pytest


@pytest.fixture
def runner_setup(tmp_path):
    tools = tmp_path / "tools"
    tools.mkdir()
    home = tmp_path / "home"
    home.mkdir()
    events = tmp_path / "events"

    def executable(name, content):
        path = tools / name
        path.write_text(content)
        path.chmod(0o755)

    executable("uname", '#!/bin/sh\nif [ "$1" = -s ]; then echo Darwin; else echo arm64; fi\n')
    executable("launchctl", '#!/bin/sh\necho "state = ${TEST_SERVICE_STATE:-running}"\n')
    package = tmp_path / "package"
    package.mkdir()
    (package / "config.sh").write_text(
        '#!/bin/sh\necho config >> "$TEST_EVENTS"\necho registered > .runner\n'
    )
    (package / "svc.sh").write_text(
        '#!/bin/sh\necho "svc $1" >> "$TEST_EVENTS"\n'
        'if [ "$1" = install ]; then echo "$TEST_PLIST" > .service; fi\n'
    )
    (package / "config.sh").chmod(0o755)
    (package / "svc.sh").chmod(0o755)
    archive = tmp_path / "runner.tar.gz"
    with tarfile.open(archive, "w:gz") as handle:
        for path in package.iterdir():
            handle.add(path, arcname=path.name)
    checksum = hashlib.sha256(archive.read_bytes()).hexdigest()
    release = tmp_path / "release.json"
    release.write_text(
        json.dumps({"body": f"<!-- BEGIN SHA osx-arm64 -->{checksum}<!-- END SHA osx-arm64 -->"})
    )
    executable(
        "curl",
        "#!/usr/bin/env python3\n"
        "import os, pathlib, shutil, sys\n"
        'pathlib.Path(os.environ["TEST_EVENTS"]).open("a").write("curl\\n")\n'
        'if os.environ.get("TEST_DOWNLOAD_FAILURE"): raise SystemExit(22)\n'
        'destination = sys.argv[sys.argv.index("-o") + 1]\n'
        'source = os.environ["TEST_RELEASE"] if "/releases/tags/" in sys.argv[-1] else os.environ["TEST_ARCHIVE"]\n'
        "shutil.copyfile(source, destination)\n",
    )
    plist = tmp_path / "runner.plist"
    plist.write_bytes(plistlib.dumps({"Label": "test.runner"}))
    environment = {
        **os.environ,
        "HOME": str(home),
        "PATH": f"{tools}:{os.environ['PATH']}",
        "TEST_EVENTS": str(events),
        "TEST_RELEASE": str(release),
        "TEST_ARCHIVE": str(archive),
        "TEST_PLIST": str(plist),
    }
    script = Path(__file__).resolve().parents[2] / "scripts/setup_isolated_runners.sh"

    def run(**changes):
        return subprocess.run(
            ["bash", str(script), "https://github.com/wat2dov2/wat2do-ui", "private-token", "1"],
            env={**environment, **changes},
            capture_output=True,
            text=True,
            timeout=20,
        )

    return home, events, archive, plist, run


def test_failed_download_does_not_create_or_register_a_runner(runner_setup):
    home, events, _, _, run = runner_setup
    result = run(TEST_DOWNLOAD_FAILURE="1")
    assert result.returncode != 0
    assert not (home / "actions-runner-1").exists()
    assert events.read_text().splitlines() == ["curl"]
    assert "private-token" not in result.stdout + result.stderr


def test_corrupt_archive_is_rejected_before_runner_registration(runner_setup):
    home, events, archive, _, run = runner_setup
    archive.write_bytes(b"truncated archive")
    result = run()
    assert result.returncode != 0
    assert "checksum mismatch" in result.stderr
    assert not (home / "actions-runner-1").exists()
    assert events.read_text().splitlines() == ["curl", "curl"]


def test_healthy_existing_runner_is_kept_without_downloading_or_reconfiguring(runner_setup):
    home, events, _, plist, run = runner_setup
    runner = home / "actions-runner-1"
    runner.mkdir()
    (runner / ".runner").write_text("existing registration")
    (runner / ".service").write_text(str(plist))
    result = run(TEST_DOWNLOAD_FAILURE="1")
    assert result.returncode == 0
    assert (runner / ".runner").read_text() == "existing registration"
    assert not events.exists()


def test_partial_service_installation_is_reported_without_losing_registration(runner_setup):
    home, events, _, _, run = runner_setup
    runner = home / "actions-runner-1"
    runner.mkdir()
    (runner / ".runner").write_text("existing registration")
    result = run()
    assert result.returncode != 0
    assert "service is not installed" in result.stderr
    assert (runner / ".runner").read_text() == "existing registration"
    assert not events.exists()


def test_loaded_but_crashing_runner_is_not_reported_healthy(runner_setup):
    home, events, _, plist, run = runner_setup
    runner = home / "actions-runner-1"
    runner.mkdir()
    (runner / ".runner").write_text("existing registration")
    (runner / ".service").write_text(str(plist))
    result = run(TEST_SERVICE_STATE="waiting")
    assert result.returncode != 0
    assert "service is not running" in result.stderr
    assert (runner / ".runner").read_text() == "existing registration"
    assert not events.exists()


def test_partial_unregistered_directory_is_preserved_for_inspection(runner_setup):
    home, events, _, _, run = runner_setup
    runner = home / "actions-runner-1"
    runner.mkdir()
    (runner / "unfinished-state").write_text("inspect me")
    result = run()
    assert result.returncode != 0
    assert "Unconfigured nonempty" in result.stderr
    assert (runner / "unfinished-state").read_text() == "inspect me"
    assert not events.exists()


def test_verified_runner_setup_bounds_logs_and_confirms_service(runner_setup):
    home, events, _, _, run = runner_setup
    result = run()
    assert result.returncode == 0, result.stderr
    runner = home / "actions-runner-1"
    assert (runner / ".runner").exists()
    assert (runner / ".env").read_text().splitlines() == [
        "RUNNER_LOGRETENTION=7",
        "WORKER_LOGRETENTION=7",
        "RUNNER_LOGSIZE=8",
        "WORKER_LOGSIZE=8",
    ]
    assert events.read_text().splitlines() == ["curl", "curl", "config", "svc install", "svc start"]
    assert "private-token" not in result.stdout + result.stderr
