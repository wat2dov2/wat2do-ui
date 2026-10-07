"""Exercise notification dependency setup without downloads or a live runner."""

import hashlib
import json
import os
import shutil
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest
import yaml

from core.controlbox import controlbox

REPO_ROOT = Path(__file__).resolve().parents[3]
WORKFLOW = yaml.safe_load((REPO_ROOT / ".github/workflows/process-notification.yml").read_text())
JOB = WORKFLOW["jobs"]["process-post"]
STEPS = {step["name"]: step for step in JOB["steps"] if "name" in step}


@pytest.fixture
def runner(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    controls = tmp_path / "backend" / "controlbox"
    controls.mkdir(parents=True)
    (controls / "notification_workflow.json").write_text(
        json.dumps(controlbox.notification_workflow.model_dump())
    )
    for name, value in {
        "NOTIFICATION_RUNTIME_ROOT": tmp_path / "tool-cache" / "notifications",
        "NOTIFICATION_RUNNER_NAME": "runner with private name",
        "UV_CACHE_DIR": tmp_path / "tool-cache" / "uv-cache",
        "TMPDIR": tmp_path,
        "GITHUB_ENV": tmp_path / "github-env",
        "GITHUB_OUTPUT": tmp_path / "github-output",
        "NOTIFICATION_JSON": "PRIVATE_NOTIFICATION_PAYLOAD",
        "SUPABASE_SECRET_KEY": "PRIVATE_CREDENTIAL",
    }.items():
        monkeypatch.setenv(name, str(value))
    return tmp_path


def preflight():
    command = STEPS["Check dependency setup capacity"]["run"]
    python = command.split("python3 - <<'PY'\n", 1)[1].rsplit("\nPY", 1)[0]
    exec(compile(python, "notification-dependency-preflight", "exec"), {})


def output_file(name):
    return dict(line.split("=", 1) for line in Path(os.environ[name]).read_text().splitlines())


def test_preflight_exports_feature_controls_and_isolates_runner_environments(
    runner, monkeypatch, capsys
):
    monkeypatch.setattr(shutil, "disk_usage", lambda _: SimpleNamespace(free=4 * 1024**3))
    preflight()
    first = output_file("GITHUB_ENV")
    expected_owner = hashlib.sha256(os.environ["NOTIFICATION_RUNNER_NAME"].encode()).hexdigest()
    assert Path(first["NOTIFICATION_VENV"]) == (
        Path(os.environ["NOTIFICATION_RUNTIME_ROOT"]) / expected_owner / "venv-3.12"
    )
    assert first["UV_HTTP_TIMEOUT"] == str(controlbox.notification_workflow.http_timeout_seconds)
    assert first["UV_HTTP_RETRIES"] == str(controlbox.notification_workflow.http_retries)
    assert output_file("GITHUB_OUTPUT") == {
        key: str(getattr(controlbox.notification_workflow, key))
        for key in ("setup_timeout_minutes", "install_timeout_minutes", "process_timeout_minutes")
    }
    monkeypatch.setenv("NOTIFICATION_RUNNER_NAME", "another runner")
    preflight()
    assert output_file("GITHUB_ENV")["NOTIFICATION_VENV"] != first["NOTIFICATION_VENV"]
    logged = capsys.readouterr().out
    assert "PRIVATE_" not in logged
    assert "runner with private name" not in logged


@pytest.mark.parametrize("failed_check", range(4))
def test_low_disk_fails_before_setup_and_does_not_export_partial_settings(
    runner, monkeypatch, capsys, failed_check
):
    capacities = iter([4 * 1024**3] * failed_check + [1024**2])
    monkeypatch.setattr(shutil, "disk_usage", lambda _: SimpleNamespace(free=next(capacities)))
    with pytest.raises(
        SystemExit, match="Insufficient disk space.*rerun this notification"
    ) as error:
        preflight()
    assert "PRIVATE_" not in str(error.value)
    assert str(runner) not in str(error.value)
    assert "runner with private name" not in str(error.value)
    assert not Path(os.environ["GITHUB_ENV"]).exists()
    assert not Path(os.environ["GITHUB_OUTPUT"]).exists()
    assert "PRIVATE_" not in capsys.readouterr().out


def test_failed_disk_check_reports_actionable_sanitized_error(runner, monkeypatch):
    def unavailable(_):
        raise OSError("PRIVATE_CREDENTIAL")

    monkeypatch.setattr(shutil, "disk_usage", unavailable)
    with pytest.raises(SystemExit, match="repair runner filesystem access") as error:
        preflight()
    assert "PRIVATE_" not in str(error.value)


@pytest.fixture
def fake_uv(runner, monkeypatch):
    executable = runner / "commands"
    executable.mkdir()
    python = executable / "fake-python"
    python.write_text("#!/bin/sh\nexit 0\n")
    python.chmod(0o755)
    uv = executable / "uv"
    uv.write_text(
        '#!/bin/sh\nprintf "%s\\n" "$*" >> "$UV_COMMAND_LOG"\n'
        'if [ "$1" = "venv" ]; then\n'
        '  mkdir -p "$NOTIFICATION_VENV/bin"\n'
        '  cp "$FAKE_PYTHON" "$NOTIFICATION_VENV/bin/python"\n'
        "fi\n"
        'exit "${UV_EXIT_CODE:-0}"\n'
    )
    uv.chmod(0o755)
    monkeypatch.setenv("PATH", f"{executable}{os.pathsep}{os.environ['PATH']}")
    monkeypatch.setenv("UV_COMMAND_LOG", str(runner / "uv-commands"))
    monkeypatch.setenv("FAKE_PYTHON", str(python))
    monkeypatch.setenv("NOTIFICATION_VENV", str(runner / "tool-cache" / "runner-env"))


def run_step(name):
    return subprocess.run(
        ["bash", "-e", "-c", STEPS[name]["run"]],
        capture_output=True,
        text=True,
        check=False,
        timeout=5,
    )


def test_setup_reuses_its_persistent_python_and_syncs_exact_locked_dependencies(fake_uv):
    assert run_step("Set up Python").returncode == 0
    commands = Path(os.environ["UV_COMMAND_LOG"])
    initial = commands.read_text()
    assert "venv --clear --python 3.12" in initial
    assert run_step("Set up Python").returncode == 0
    assert commands.read_text() == initial
    assert run_step("Install dependencies").returncode == 0
    assert commands.read_text().splitlines()[-1] == (
        f"pip sync --python {os.environ['NOTIFICATION_VENV']}/bin/python requirements.lock"
    )


def test_dependency_failure_is_terminal_and_actionable(fake_uv, monkeypatch):
    monkeypatch.setenv("UV_EXIT_CODE", "1")
    result = run_step("Install dependencies")
    assert result.returncode == 1
    assert "check runner disk capacity" in result.stderr.lower()
    assert "rerun this notification" in result.stderr
    assert "PRIVATE_" not in result.stderr


def test_missing_routing_fails_without_logging_payload(runner, monkeypatch):
    for name in (
        "AWS_DEPLOY_ROLE_ARN",
        "FRONTEND_URL",
        "SUPABASE_URL",
        "SUPABASE_KEY",
        "OPENAI_API_KEY",
        "EVENT_FEED_REVALIDATION_SECRET",
    ):
        monkeypatch.setenv(name, "configured")
    monkeypatch.setenv("INTENDED_RECIPIENT_ID", "")
    monkeypatch.setenv("TARGET_SCHOOL", "")
    result = run_step("Validate job inputs")
    assert result.returncode == 1
    assert "Notification routing is missing" in result.stderr
    assert "PRIVATE_" not in result.stdout + result.stderr


def test_setup_and_processing_steps_have_bounded_consistent_runtime():
    preflight_index = JOB["steps"].index(STEPS["Check dependency setup capacity"])
    for name, timeout in (
        ("Install uv", "setup_timeout_minutes"),
        ("Set up Python", "setup_timeout_minutes"),
        ("Install dependencies", "install_timeout_minutes"),
        ("Process the Instagram account", "process_timeout_minutes"),
    ):
        step = STEPS[name]
        assert JOB["steps"].index(step) > preflight_index
        assert step["timeout-minutes"] == (
            "${{ fromJSON(steps.dependencies.outputs." + timeout + ") }}"
        )
    assert STEPS["Install uv"]["with"]["cache-local-path"] == "${{ env.UV_CACHE_DIR }}"
    assert "runner.tool_cache" in JOB["env"]["UV_CACHE_DIR"]
    assert ".venv/bin/python" not in STEPS["Process the Instagram account"]["run"]
    assert "skip=true" not in STEPS["Validate job inputs"]["run"]
