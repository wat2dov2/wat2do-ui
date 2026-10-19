import json
import re
import subprocess
from types import SimpleNamespace

import pytest

from services import claude_code


def test_agent_gets_only_its_tools_and_no_secrets(monkeypatch, tmp_path):
    calls = []
    removed = []
    monkeypatch.setattr(claude_code.shutil, "which", lambda _name: "/usr/local/bin/claude")
    monkeypatch.setattr(claude_code, "remove_run_folder", removed.append)
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "never-passed")

    def run(command, **kwargs):
        calls.append((command, kwargs))
        return SimpleNamespace(returncode=0, stdout=json.dumps({"structured_output": {"ok": 1}}))

    monkeypatch.setattr(claude_code.subprocess, "run", run)

    answer = claude_code.run_agent(
        "prompt",
        workdir=str(tmp_path),
        model="claude-haiku-5-5",
        tools=("WebSearch", "WebFetch"),
        allowed_tools=("WebSearch", "WebFetch"),
        schema={"type": "object"},
        timeout=60,
    )

    assert answer == {"ok": 1}
    command, kwargs = calls[0]
    assert command[command.index("--tools") + 1] == "WebSearch,WebFetch"
    allowed = command[command.index("--allowedTools") + 1 : command.index("--permission-mode")]
    assert allowed == ["WebSearch", "WebFetch"]
    assert command[command.index("--model") + 1] == "claude-haiku-5-5"
    assert kwargs["input"] == "prompt" and kwargs["timeout"] == 60
    assert "SUPABASE_SECRET_KEY" not in kwargs["env"]
    assert removed == [str(tmp_path)]


@pytest.mark.parametrize(
    ("result", "message"),
    [
        (SimpleNamespace(returncode=2, stdout=""), "exit 2"),
        (SimpleNamespace(returncode=0, stdout="oops"), "no answer"),
        (subprocess.TimeoutExpired("claude", 1), "TimeoutExpired"),
    ],
)
def test_a_failed_or_empty_run_raises_and_still_cleans_up(monkeypatch, tmp_path, result, message):
    removed = []
    monkeypatch.setattr(claude_code.shutil, "which", lambda _name: "/usr/local/bin/claude")
    monkeypatch.setattr(claude_code, "remove_run_folder", removed.append)

    def run(*_args, **_kwargs):
        if isinstance(result, BaseException):
            raise result
        return result

    monkeypatch.setattr(claude_code.subprocess, "run", run)
    with pytest.raises(claude_code.ClaudeCodeError, match=message):
        claude_code.run_agent(
            "prompt",
            workdir=str(tmp_path),
            model="m",
            tools=("Read",),
            allowed_tools=("Read(./**)",),
            schema={},
            timeout=1,
        )
    assert removed == [str(tmp_path)]


def test_leftover_run_folders_are_removed_but_nothing_else(monkeypatch, tmp_path):
    temp = tmp_path / "tmp"
    projects = tmp_path / "projects"
    for folder in (
        temp / "wat2do-ingestion-abc",
        temp / "other-work",
        projects / "-private-var-T-wat2do-ingestion-abc",
        projects / "-Users-me-code",
    ):
        folder.mkdir(parents=True)
    monkeypatch.setattr(claude_code.tempfile, "gettempdir", lambda: str(temp))
    monkeypatch.setattr(claude_code, "claude_projects", lambda: projects)

    claude_code.remove_leftovers("wat2do-ingestion-")

    assert [path.name for path in temp.iterdir()] == ["other-work"]
    assert [path.name for path in projects.iterdir()] == ["-Users-me-code"]


def test_a_run_folder_is_named_after_the_working_directory(monkeypatch, tmp_path):
    projects = tmp_path / "projects"
    workdir = tmp_path / "wat2do-ingestion-x_y"
    workdir.mkdir()
    name = re.sub(r"[^A-Za-z0-9]", "-", str(workdir.resolve()))
    (projects / name).mkdir(parents=True)
    monkeypatch.setattr(claude_code, "claude_projects", lambda: projects)

    claude_code.remove_run_folder(str(workdir))

    assert list(projects.iterdir()) == []
