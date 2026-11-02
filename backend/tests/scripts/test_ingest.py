import json
import sys
from pathlib import Path

import pytest

from scripts import ingest as script
from services.ingestion import directory_agent, items


@pytest.mark.parametrize(
    ("command", "label", "schedule"),
    [
        ("process", "io.wat2do.ingestion.process", {"KeepAlive": True}),
        (
            "scrape-directories",
            "io.wat2do.ingestion.directories",
            {"StartInterval": script.CONTROL.directory_scrape_interval_seconds},
        ),
    ],
)
def test_launch_agent_payload_runs_one_command_without_logs(command, label, schedule):
    payload = script.launch_agent_payload(command)

    assert payload["Label"] == label
    # The processor stays running; only the directory scrape repeats on an interval.
    assert {
        key: payload[key] for key in ("KeepAlive", "StartInterval") if key in payload
    } == schedule
    if command == "process":
        # The Rust processor is built from this checkout on every start.
        assert payload["ProgramArguments"] == [
            str(Path.home() / ".cargo/bin/cargo"),
            "run",
            "--release",
            "--quiet",
            "--manifest-path",
            str(script.REPOSITORY_DIRECTORY / "rust/Cargo.toml"),
            "--bin",
            "wat2do-ingest",
            "--",
            "process",
        ]
    else:
        assert payload["ProgramArguments"] == [
            sys.executable,
            str(Path(script.__file__).resolve()),
            command,
        ]
    assert payload["WorkingDirectory"] == str(script.BACKEND_DIRECTORY)
    assert payload["RunAtLoad"] is True
    assert payload["ProcessType"] == "Background"
    assert payload["StandardOutPath"] == "/dev/null"
    assert payload["StandardErrorPath"] == "/dev/null"
    path = payload["EnvironmentVariables"]["PATH"].split(":")
    # cargo and Claude Code install their launchers under home, which launchd omits.
    assert path[:2] == [str(Path.home() / ".cargo/bin"), str(Path.home() / ".local/bin")]
    assert "/opt/homebrew/bin" in path
    assert "/usr/bin" in path


def test_install_schedule_installs_both_agents(monkeypatch, tmp_path, capsys):
    installed = []
    monkeypatch.setattr(script.Path, "home", lambda: tmp_path)
    monkeypatch.setattr(
        script,
        "install_launch_agent",
        lambda path, payload, **kwargs: installed.append((path, payload["Label"], kwargs)),
    )

    script.install_schedule()

    assert installed == [
        (
            tmp_path / "Library/LaunchAgents/io.wat2do.ingestion.process.plist",
            "io.wat2do.ingestion.process",
            {"timeout": script.CONTROL.launch_agent_timeout_seconds, "poll_interval_seconds": 1},
        ),
        (
            tmp_path / "Library/LaunchAgents/io.wat2do.ingestion.directories.plist",
            "io.wat2do.ingestion.directories",
            {"timeout": script.CONTROL.launch_agent_timeout_seconds, "poll_interval_seconds": 1},
        ),
    ]
    output = capsys.readouterr().out
    assert "io.wat2do.ingestion.process (always on)" in output
    assert "io.wat2do.ingestion.directories every 43200 seconds" in output


@pytest.mark.parametrize(
    ("argv", "patched", "result", "options"),
    [
        (["scrape-directories"], (directory_agent, "scrape_directories"), {"queued": 3}, {}),
    ],
)
def test_main_runs_the_command(monkeypatch, capsys, argv, patched, result, options):
    calls = []
    monkeypatch.setattr(*patched, lambda **kwargs: calls.append(kwargs) or result)
    monkeypatch.setattr(sys, "argv", ["ingest.py", *argv])

    assert script.main() == 0

    assert calls == [options]
    assert json.loads(capsys.readouterr().out) == result


def test_main_enqueue_queues_post_urls(monkeypatch, capsys):
    calls = []
    monkeypatch.setattr(
        items, "queue_instagram", lambda urls, *, school: calls.append((urls, school)) or 2
    )
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "ingest.py",
            "enqueue",
            "--school",
            "uwaterloo",
            "--url",
            "https://www.instagram.com/p/ABC/",
            "--url",
            "https://www.instagram.com/reel/XYZ/",
        ],
    )

    assert script.main() == 0

    assert calls == [
        (
            ["https://www.instagram.com/p/ABC/", "https://www.instagram.com/reel/XYZ/"],
            "uwaterloo",
        )
    ]
    assert json.loads(capsys.readouterr().out) == {"queued": 2}


def test_main_status_prints_queue_counts(monkeypatch, capsys):
    monkeypatch.setattr(items, "counts", lambda: {"fetch": 1, "ready": 2})
    monkeypatch.setattr(sys, "argv", ["ingest.py", "status"])

    assert script.main() == 0

    assert json.loads(capsys.readouterr().out) == {"fetch": 1, "ready": 2}
