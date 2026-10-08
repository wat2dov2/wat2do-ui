"""Exercise notification setup and its pinned GitHub expression validator."""

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
    tool_cache = runner / "tool cache"
    for name, value in {
        "RUNNER_TOOL_CACHE": tool_cache,
        "RUNNER_OS": "macOS",
        "RUNNER_ARCH": "ARM64",
        "RUNNER_NAME": "runner with private name",
        "RUNNER_TEMP": runner,
    }.items():
        monkeypatch.setenv(name, str(value))
    result = run_step("Prepare notification runtime")
    assert result.returncode == 0
    runtime_root = tool_cache / "wat2do-notification-macOS-ARM64"
    settings = output_file("GITHUB_ENV")
    assert settings == {
        "NOTIFICATION_RUNTIME_ROOT": str(runtime_root),
        "NOTIFICATION_RUNNER_NAME": "runner with private name",
        "UV_CACHE_DIR": str(runtime_root / "uv-cache"),
        "UV_PYTHON_INSTALL_DIR": str(runtime_root / "python"),
        "TMPDIR": str(runner),
    }
    for name, value in settings.items():
        monkeypatch.setenv(name, value)
    assert not result.stdout + result.stderr
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
        for key in (
            "uv_version",
            "setup_timeout_minutes",
            "install_timeout_minutes",
            "process_timeout_minutes",
        )
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
        'if [ "$1 $2 $3" = "cache prune --ci" ]; then\n'
        '  printf "%s\\n" "$UV_LOCK_TIMEOUT" >> "$UV_LOCK_LOG"\n'
        '  if [ -n "${UV_PRUNE_SLEEP:-}" ]; then exec sleep "$UV_PRUNE_SLEEP"; fi\n'
        '  printf "%s\\n" "PRIVATE_CACHE_STDOUT"\n'
        '  printf "%s\\n" "PRIVATE_CACHE_STDERR" >&2\n'
        '  if [ "${UV_EXIT_CODE:-0}" = "0" ]; then rm -rf "$UV_CACHE_DIR/reproducible-builds"; fi\n'
        "fi\n"
        'exit "${UV_EXIT_CODE:-0}"\n'
    )
    uv.chmod(0o755)
    monkeypatch.setenv("PATH", f"{executable}{os.pathsep}{os.environ['PATH']}")
    monkeypatch.setenv("UV_COMMAND_LOG", str(runner / "uv-commands"))
    monkeypatch.setenv("UV_LOCK_LOG", str(runner / "uv-lock-timeout"))
    monkeypatch.setenv("FAKE_PYTHON", str(python))
    monkeypatch.setenv("NOTIFICATION_VENV", str(runner / "tool-cache" / "runner-env"))


def run_step(name):
    return subprocess.run(
        ["bash", "-e", "-c", STEPS[name]["run"]],
        cwd=STEPS[name].get("working-directory", "."),
        capture_output=True,
        text=True,
        check=False,
        timeout=5,
    )


def check_workflow(content=None, *, offline=True):
    result = subprocess.run(
        ["bash", str(REPO_ROOT / "scripts/check-notification-workflow.sh")]
        + (["--offline"] if offline else [])
        + (["-"] if content else []),
        input=content,
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
        timeout=30,
    )
    if result.returncode == 69 and "cache is not provisioned" in result.stderr:
        pytest.skip("Run the required pre-push/CI workflow gate to provision pinned actionlint")
    return result


def test_pinned_actionlint_accepts_notification_workflow():
    result = check_workflow()
    assert result.returncode == 0, result.stdout + result.stderr


def test_pinned_actionlint_rejects_runner_context_unavailable_in_job_environment():
    content = (
        (REPO_ROOT / ".github/workflows/process-notification.yml")
        .read_text()
        .replace(
            "\n    env:\n",
            "\n    env:\n      INVALID_BEFORE_RUNNER: ${{ runner.tool_cache }}\n",
            1,
        )
    )
    result = check_workflow(content)
    assert result.returncode != 0
    assert 'context "runner" is not allowed here' in result.stdout


@pytest.fixture
def fake_workflow_download(tmp_path, monkeypatch):
    source = Path(os.getenv("XDG_CACHE_HOME", Path.home() / ".cache")) / "wat2do-workflow-tools"
    cache_root = tmp_path / "cache"
    commands = tmp_path / "commands"
    commands.mkdir()
    curl = commands / "curl"
    curl.write_text(
        "#!/bin/sh\n"
        'while [ "$#" -gt 0 ]; do\n'
        '  case "$1" in\n'
        '    --output) output="$2"; shift 2 ;;\n'
        '    https://*) archive="${1##*/}"; shift ;;\n'
        "    *) shift ;;\n"
        "  esac\n"
        "done\n"
        'printf "%s\\n" download >> "$CURL_LOG"\n'
        'printf "%s" "invalid archive" > "$output"\n'
        'if [ -n "${CURL_SOURCE:-}" ]; then cp "$CURL_SOURCE/$archive" "$output"; fi\n'
        'exit "${CURL_RESULT:-0}"\n'
    )
    curl.chmod(0o755)
    monkeypatch.setenv("PATH", f"{commands}{os.pathsep}{os.environ['PATH']}")
    monkeypatch.setenv("XDG_CACHE_HOME", str(cache_root))
    monkeypatch.setenv("CURL_LOG", str(tmp_path / "downloads"))
    return source, cache_root / "wat2do-workflow-tools", tmp_path / "downloads"


def test_pinned_actionlint_repairs_corrupt_cache_before_running_validator(
    fake_workflow_download, monkeypatch
):
    source, cache, downloads = fake_workflow_download
    if not source.exists() or not list(source.glob("*.tar.gz")):
        pytest.skip("Run the required pre-push/CI workflow gate to provision pinned actionlint")
    shutil.copytree(source, cache)
    for archive in cache.glob("*.tar.gz"):
        archive.write_bytes(b"corrupted cached download")
    monkeypatch.setenv("CURL_SOURCE", str(source))
    result = check_workflow(offline=False)
    assert result.returncode == 0, result.stdout + result.stderr
    assert downloads.read_text().splitlines() == ["download"]
    assert any(
        archive.read_bytes() == (source / archive.name).read_bytes()
        for archive in cache.glob("*.tar.gz")
    )


@pytest.mark.parametrize("download_result", [0, 28])
def test_failed_or_bad_download_never_publishes_unverified_validator(
    fake_workflow_download, monkeypatch, download_result
):
    _, cache, downloads = fake_workflow_download
    monkeypatch.setenv("CURL_RESULT", str(download_result))
    result = check_workflow(offline=False)
    assert result.returncode != 0
    assert downloads.read_text().splitlines() == ["download"]
    assert not list(cache.glob("*.tar.gz"))
    if not download_result:
        assert "Downloaded actionlint archive checksum mismatch" in result.stderr


def test_offline_validator_requires_preprovisioned_cache_without_downloading(
    fake_workflow_download,
):
    _, _, downloads = fake_workflow_download
    with pytest.raises(pytest.skip.Exception, match="provision pinned actionlint"):
        check_workflow()
    assert not downloads.exists()


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


def test_cache_cleanup_only_prunes_reproducible_cache_and_preserves_environment(fake_uv, runner):
    cache = Path(os.environ["UV_CACHE_DIR"]) / "reproducible-builds"
    cache.mkdir(parents=True)
    (cache / "unused-wheel").write_text("reproducible")
    environment = Path(os.environ["NOTIFICATION_VENV"])
    environment.mkdir(parents=True)
    sentinel = environment / "keep-environment"
    sentinel.write_text("installed packages")
    evidence = runner / "evidence.json"
    evidence.write_text('{"keep": "reviewed evidence"}')

    result = run_step("Maintain notification dependency cache")

    assert result.returncode == 0
    assert Path(os.environ["UV_COMMAND_LOG"]).read_text().splitlines() == ["cache prune --ci"]
    assert Path(os.environ["UV_LOCK_LOG"]).read_text().strip() == str(
        controlbox.notification_workflow.cache_cleanup_timeout_seconds
    )
    assert not cache.exists()
    assert sentinel.read_text() == "installed packages"
    assert evidence.read_text() == '{"keep": "reviewed evidence"}'
    assert "PRIVATE_" not in result.stdout + result.stderr


def test_cache_cleanup_failure_warns_without_leaking_command_output(fake_uv, monkeypatch):
    monkeypatch.setenv("UV_EXIT_CODE", "1")

    result = run_step("Maintain notification dependency cache")

    assert result.returncode == 0
    assert "::warning::" in result.stdout + result.stderr
    assert "PRIVATE_" not in result.stdout + result.stderr


def test_cache_cleanup_timeout_is_bounded_and_preserves_job_success(fake_uv, runner, monkeypatch):
    controls = runner / "backend" / "controlbox" / "notification_workflow.json"
    settings = json.loads(controls.read_text())
    settings["cache_cleanup_timeout_seconds"] = 1
    controls.write_text(json.dumps(settings))
    monkeypatch.setenv("UV_PRUNE_SLEEP", "2")

    result = run_step("Maintain notification dependency cache")

    assert result.returncode == 0
    assert Path(os.environ["UV_LOCK_LOG"]).read_text().strip() == "1"
    assert "::warning::" in result.stdout + result.stderr
    assert "PRIVATE_" not in result.stdout + result.stderr


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
    assert JOB["steps"].index(STEPS["Prepare notification runtime"]) < preflight_index
    install_uv = STEPS["Install uv"]
    assert install_uv["id"] == "uv"
    assert install_uv["with"]["version"] == "${{ steps.dependencies.outputs.uv_version }}"
    maintenance = STEPS["Maintain notification dependency cache"]
    assert JOB["steps"][-1] == maintenance
    assert maintenance["if"].removeprefix("${{").removesuffix("}}").strip() == (
        "always() && steps.uv.outcome == 'success'"
    )
