import json
import sys
from pathlib import Path

import pytest

from scripts import ingest as script
from services.ingestion import directory, processor
from services.ingestion.queue import IngestionQueue, QueueItem


@pytest.mark.parametrize(
    ("command", "label", "interval"),
    [
        ("process", "io.wat2do.ingestion.process", script.CONTROL.process_interval_seconds),
        (
            "scrape-directories",
            "io.wat2do.ingestion.directories",
            script.CONTROL.directory_scrape_interval_seconds,
        ),
    ],
)
def test_launch_agent_payload_runs_one_command_on_its_interval_without_logs(
    command, label, interval
):
    payload = script.launch_agent_payload(command)

    assert payload["Label"] == label
    assert payload["StartInterval"] == interval
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
    # Claude Code installs its launcher in ~/.local/bin, which launchd omits.
    assert path[0] == str(Path.home() / ".local/bin")
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
    assert "io.wat2do.ingestion.process every" in capsys.readouterr().out


@pytest.mark.parametrize(
    ("command", "patched", "result"),
    [
        ("process", (processor, "process_queue"), {"processed": 2, "failed": 0}),
        ("scrape-directories", (directory, "scrape_directories"), {"queued": 3}),
    ],
)
def test_main_runs_the_command_against_the_local_queue(
    monkeypatch, tmp_path, capsys, command, patched, result
):
    monkeypatch.setenv("XDG_STATE_HOME", str(tmp_path))
    queues = []
    monkeypatch.setattr(*patched, lambda queue: queues.append(queue) or result)
    monkeypatch.setattr(sys, "argv", ["ingest.py", command])

    assert script.main() == 0

    assert queues[0].state_directory == tmp_path / "wat2do/ingestion"
    assert json.loads(capsys.readouterr().out) == result


def test_main_status_prints_queue_counts(monkeypatch, tmp_path, capsys):
    monkeypatch.setenv("XDG_STATE_HOME", str(tmp_path))
    IngestionQueue().enqueue(
        QueueItem(school="upenn", post={"url": "https://example.edu/events/1"})
    )
    monkeypatch.setattr(sys, "argv", ["ingest.py", "status"])

    assert script.main() == 0

    assert json.loads(capsys.readouterr().out) == {"checked": 0, "queued": 1}
