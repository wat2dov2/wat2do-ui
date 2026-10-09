"""Exercise notification setup and its pinned GitHub expression validator."""

import hashlib
import importlib.util
import json
import os
import runpy
import shutil
import subprocess
import sys
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
    scripts = tmp_path / "backend" / "scripts"
    scripts.mkdir()
    shutil.copyfile(
        REPO_ROOT / "backend/scripts/notification_runtime.py",
        scripts / "notification_runtime.py",
    )
    for name, value in {
        "RUNNER_TOOL_CACHE": tmp_path / "tool-cache",
        "RUNNER_WORKSPACE": tmp_path,
        "GITHUB_WORKSPACE": tmp_path,
        "NOTIFICATION_RUNTIME_ROOT": tmp_path / "tool-cache" / "notifications",
        "NOTIFICATION_RUNNER_NAME": "runner with private name",
        "UV_CACHE_DIR": tmp_path / "tool-cache" / "notifications" / "uv-cache",
        "TMPDIR": tmp_path,
        "GITHUB_ENV": tmp_path / "github-env",
        "GITHUB_OUTPUT": tmp_path / "github-output",
        "NOTIFICATION_JSON": "PRIVATE_NOTIFICATION_PAYLOAD",
        "SUPABASE_SECRET_KEY": "PRIVATE_CREDENTIAL",
    }.items():
        monkeypatch.setenv(name, str(value))
    monkeypatch.setattr(shutil, "which", lambda _: None)
    return tmp_path


@pytest.fixture
def runtime(runner):
    helper = runner / "backend/scripts/notification_runtime.py"
    spec = importlib.util.spec_from_file_location("notification_runtime_test", helper)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def preflight():
    helper = Path.cwd() / "backend/scripts/notification_runtime.py"
    original_arguments = sys.argv
    sys.argv = [str(helper), "prepare"]
    try:
        try:
            runpy.run_path(str(helper), run_name="__main__")
        except SystemExit as exc:
            if exc.code not in (None, 0):
                raise
    finally:
        sys.argv = original_arguments


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
    assert first["UV_LINK_MODE"] == "copy"
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


def test_preflight_recovers_low_capacity_before_admission(
    runtime, runner, fake_uv, monkeypatch, capsys
):
    capacity = {"free": 1024**3}
    commands = []

    def cleanup(command, **kwargs):
        commands.append(command[1:])
        assert float(kwargs["env"]["UV_LOCK_TIMEOUT"]) <= 30
        if command[1:] == ["cache", "prune", "--ci"]:
            capacity["free"] = 3 * 1024**3
        return SimpleNamespace(stdout="0" if command[2] == "size" else "PRIVATE_CACHE_OUTPUT")

    monkeypatch.setattr(runtime.shutil, "disk_usage", lambda _: SimpleNamespace(**capacity))
    monkeypatch.setattr(runtime.subprocess, "run", cleanup)
    controls = json.loads(runtime.CONTROL_PATH.read_text())
    controls["cleanup_free_disk_mb"] = 2048

    runtime.prepare(controls)

    assert commands[0] == ["cache", "prune", "--ci"]
    assert output_file("GITHUB_ENV")["UV_LINK_MODE"] == "copy"
    assert output_file("GITHUB_OUTPUT")["uv_version"] == controls["uv_version"]
    assert "PRIVATE_" not in capsys.readouterr().out


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
        'if [ "$1 $2" = "cache size" ]; then\n'
        '  printf "%s\\n" "${UV_CACHE_SIZE_BYTES:-0}"\n'
        "fi\n"
        'if [ "$1 $2" = "cache clean" ]; then\n'
        '  printf "%s\\n" "$UV_LOCK_TIMEOUT" >> "$UV_LOCK_LOG"\n'
        '  if [ "${UV_EXIT_CODE:-0}" = "0" ]; then\n'
        '    rm -rf "$UV_CACHE_DIR/reproducible-builds" "$UV_CACHE_DIR/built-wheel"\n'
        "  fi\n"
        "fi\n"
        'exit "${UV_EXIT_CODE:-0}"\n'
    )
    uv.chmod(0o755)
    monkeypatch.setenv("PATH", f"{executable}{os.pathsep}{os.environ['PATH']}")
    monkeypatch.setenv("UV_COMMAND_LOG", str(runner / "uv-commands"))
    monkeypatch.setenv("UV_LOCK_LOG", str(runner / "uv-lock-timeout"))
    monkeypatch.setenv("FAKE_PYTHON", str(python))
    monkeypatch.setenv("NOTIFICATION_VENV", str(runner / "tool-cache" / "runner-env"))
    monkeypatch.setattr(shutil, "which", lambda command: str(uv) if command == "uv" else None)


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
    commands = Path(os.environ["UV_COMMAND_LOG"]).read_text().splitlines()
    assert "cache prune --ci" in commands
    assert "cache clean" not in commands
    assert all("--force" not in command for command in commands)
    lock_timeout = float(Path(os.environ["UV_LOCK_LOG"]).read_text().strip())
    assert 0 < lock_timeout <= controlbox.notification_workflow.cache_cleanup_timeout_seconds
    assert not cache.exists()
    assert sentinel.read_text() == "installed packages"
    assert evidence.read_text() == '{"keep": "reviewed evidence"}'
    assert "PRIVATE_" not in result.stdout + result.stderr


def test_cache_size_cap_uses_native_clean_and_preserves_installed_environment(
    fake_uv, runner, monkeypatch
):
    cache = Path(os.environ["UV_CACHE_DIR"])
    cache.mkdir(parents=True)
    (cache / "built-wheel").write_text("reproducible wheel")
    environment = Path(os.environ["NOTIFICATION_VENV"])
    environment.mkdir(parents=True)
    sentinel = environment / "installed-package"
    sentinel.write_text("keep")
    monkeypatch.setenv("UV_CACHE_SIZE_BYTES", str(1024**3))

    result = run_step("Maintain notification dependency cache")

    assert result.returncode == 0
    commands = Path(os.environ["UV_COMMAND_LOG"]).read_text().splitlines()
    assert "cache clean" in commands
    assert all("--force" not in command for command in commands)
    assert not (cache / "built-wheel").exists()
    assert sentinel.read_text() == "keep"
    assert "PRIVATE_" not in result.stdout + result.stderr


def test_cache_cleanup_preserves_environment_symlinks_to_cached_packages(fake_uv, runner):
    cache = Path(os.environ["UV_CACHE_DIR"])
    cache.mkdir(parents=True)
    wheel = cache / "built-wheel"
    wheel.write_text("installed package target")
    owner = hashlib.sha256(os.environ["NOTIFICATION_RUNNER_NAME"].encode()).hexdigest()
    environment = Path(os.environ["NOTIFICATION_RUNTIME_ROOT"]) / owner / "venv-3.12"
    environment.mkdir(parents=True)
    link = environment / "package"
    link.symlink_to(wheel)

    result = run_step("Maintain notification dependency cache")

    assert result.returncode == 0
    assert "uses cache links" in result.stdout
    assert not Path(os.environ["UV_COMMAND_LOG"]).exists()
    assert link.read_text() == "installed package target"


def test_cache_maintenance_preserves_runtime_with_symlink_ancestor(
    runtime, fake_uv, runner, monkeypatch, capsys
):
    original = runner / "runtime-owner"
    cache = original / "uv-cache"
    cache.mkdir(parents=True)
    sentinel = cache / "built-wheel"
    sentinel.write_text("keep")
    alias = runner / "runtime-alias"
    alias.symlink_to(original, target_is_directory=True)
    monkeypatch.setenv("NOTIFICATION_RUNTIME_ROOT", str(alias))
    monkeypatch.setenv("UV_CACHE_DIR", str(alias / "uv-cache"))

    runtime.maintain(json.loads(runtime.CONTROL_PATH.read_text()))

    assert not Path(os.environ["UV_COMMAND_LOG"]).exists()
    assert sentinel.read_text() == "keep"
    assert "::warning::" in capsys.readouterr().out


@pytest.mark.parametrize("blocker", ["unreadable", "cyclic_symlink"])
def test_cache_maintenance_defers_when_environment_links_cannot_be_inspected(
    runtime, fake_uv, runner, monkeypatch, capsys, blocker
):
    cache = Path(os.environ["UV_CACHE_DIR"])
    cache.mkdir(parents=True)
    sentinel = cache / "built-wheel"
    sentinel.write_text("keep")
    owner = hashlib.sha256(os.environ["NOTIFICATION_RUNNER_NAME"].encode()).hexdigest()
    environment = Path(os.environ["NOTIFICATION_RUNTIME_ROOT"]) / owner / "venv-3.12"
    environment.mkdir(parents=True)
    if blocker == "unreadable":

        def inaccessible(_path, *, onerror):
            onerror(PermissionError("PRIVATE_DIRECTORY_ERROR"))
            return iter(())

        monkeypatch.setattr(runtime.os, "walk", inaccessible)
    else:
        (environment / "a").symlink_to("b")
        (environment / "b").symlink_to("a")

    runtime.maintain(json.loads(runtime.CONTROL_PATH.read_text()))

    assert not Path(os.environ["UV_COMMAND_LOG"]).exists()
    assert sentinel.read_text() == "keep"
    logged = capsys.readouterr().out
    assert "::warning::" in logged
    assert "PRIVATE_" not in logged
    assert str(runner) not in logged


@pytest.fixture
def owned_tools(runtime, runner, monkeypatch):
    owner = runner / "registered-runner"
    tool_cache = owner / "_work" / "_tool"
    root = tool_cache / "uv"
    root.mkdir(parents=True)
    registration = owner / ".runner"
    registration.write_text(
        json.dumps({"agentName": os.environ["NOTIFICATION_RUNNER_NAME"], "workFolder": "_work"}),
        encoding="utf-8-sig",
    )
    monkeypatch.setenv("RUNNER_ENVIRONMENT", "self-hosted")
    monkeypatch.setenv("GITHUB_ACTIONS", "true")
    monkeypatch.setenv("RUNNER_TOOL_CACHE", str(tool_cache))
    monkeypatch.setenv("RUNNER_ARCH", "ARM64")
    versions = ["0.12.0", "0.12.1", "0.12.2", "0.12.3", controlbox.notification_workflow.uv_version]
    for version in versions:
        binaries = root / version / "aarch64"
        binaries.mkdir(parents=True)
        for name in ("uv", "uvx"):
            binary = binaries / name
            binary.write_text("#!/bin/sh\nexit 0\n")
            binary.chmod(0o755)
        (root / version / "aarch64.complete").touch()
    inspector = runner / "lsof"
    inspector.write_text("unused inspector fixture")
    monkeypatch.setattr(
        runtime.shutil, "which", lambda name: str(inspector) if name == "lsof" else None
    )
    return root, registration


def test_owned_tool_retention_preserves_active_current_pinned_and_unknown_versions(
    runtime, owned_tools, runner, monkeypatch
):
    root, _ = owned_tools
    current = root / "0.12.2" / "aarch64" / "uv"
    active = root / "0.12.1" / "aarch64" / "uv"
    incomplete = root / "0.12.4"
    incomplete.mkdir()
    (incomplete / "private-layout").write_text("keep")
    foreign = runner / "external-tool"
    foreign.mkdir()
    sentinel = foreign / "keep"
    sentinel.write_text("foreign data")
    (root / "0.12.5").symlink_to(foreign, target_is_directory=True)
    actual_run = subprocess.run

    def inspect_and_execute(command, **kwargs):
        if command[0] == str(runner / "lsof"):
            return SimpleNamespace(returncode=0, stdout=f"p123\nn{active}\n", stderr="")
        assert command[0] == sys.executable
        assert Path(command[-1]).parent == root
        assert 0 < kwargs["timeout"] <= 30
        return actual_run(command, **kwargs)

    monkeypatch.setattr(runtime.subprocess, "run", inspect_and_execute)

    controls = json.loads(runtime.CONTROL_PATH.read_text())
    assert runtime.owned_tool_root() == root
    assert runtime.cached_uv(controls) == str(root / controls["uv_version"] / "aarch64" / "uv")
    runtime.prune_tool_versions(controls, str(current), runtime.time.monotonic() + 30)

    assert not (root / "0.12.0").exists()
    for version in ["0.12.1", "0.12.2", "0.12.3", controls["uv_version"]]:
        assert (root / version / "aarch64" / "uv").exists()
    assert (incomplete / "private-layout").read_text() == "keep"
    assert (root / "0.12.5").is_symlink()
    assert sentinel.read_text() == "foreign data"


def test_obsolete_tool_deletion_timeout_is_nonfatal_and_preserves_selected_tool(
    runtime, owned_tools, runner, monkeypatch, capsys
):
    root, _ = owned_tools
    attempted = []

    def timed_out_deletion(command, **kwargs):
        if command[0] == str(runner / "lsof"):
            return SimpleNamespace(returncode=1, stdout="", stderr="")
        assert command[0] == sys.executable
        assert Path(command[-1]).parent == root
        assert 0 < kwargs["timeout"] <= 30
        attempted.append(command)
        raise subprocess.TimeoutExpired(
            command, kwargs["timeout"], output="PRIVATE_OUTPUT", stderr="PRIVATE_ERROR"
        )

    monkeypatch.setattr(runtime.subprocess, "run", timed_out_deletion)

    runtime.maintain(json.loads(runtime.CONTROL_PATH.read_text()))

    assert len(attempted) == 1
    assert (root / controlbox.notification_workflow.uv_version / "aarch64" / "uv").exists()
    assert (root / "0.12.2" / "aarch64" / "uv").exists()
    logged = capsys.readouterr().out
    assert "::warning::" in logged
    assert "PRIVATE_" not in logged
    assert str(runner) not in logged


@pytest.mark.parametrize(
    "blocker",
    [
        "foreign_registration",
        "shared_root",
        "symlink_root",
        "symlink_ancestor",
        "inspection_failure",
        "manual_context",
    ],
)
def test_tool_retention_preserves_unowned_or_uninspectable_versions(
    runtime, owned_tools, runner, monkeypatch, blocker
):
    root, registration = owned_tools
    if blocker == "foreign_registration":
        registration.write_text(json.dumps({"agentName": "foreign", "workFolder": "_work"}))
    elif blocker == "shared_root":
        shared = root.parents[2] / "shared" / "_tool"
        shutil.copytree(root, shared / "uv")
        monkeypatch.setenv("RUNNER_TOOL_CACHE", str(shared))
        root = shared / "uv"
    elif blocker == "symlink_root":
        alias = root.parent.parent / "alias"
        alias.symlink_to(root.parent, target_is_directory=True)
        monkeypatch.setenv("RUNNER_TOOL_CACHE", str(alias))
    elif blocker == "symlink_ancestor":
        alias = runner / "runner-alias"
        alias.symlink_to(registration.parent, target_is_directory=True)
        monkeypatch.setenv("RUNNER_TOOL_CACHE", str(alias / "_work" / "_tool"))
    elif blocker == "manual_context":
        monkeypatch.setenv("GITHUB_ACTIONS", "false")
    monkeypatch.setattr(
        runtime.subprocess,
        "run",
        lambda *args, **kwargs: SimpleNamespace(
            returncode=2 if blocker == "inspection_failure" else 1,
            stdout="",
            stderr="PRIVATE_INSPECTION_ERROR" if blocker == "inspection_failure" else "",
        ),
    )
    before = sorted(str(path.relative_to(root)) for path in root.rglob("*"))

    runtime.prune_tool_versions(
        json.loads(runtime.CONTROL_PATH.read_text()), None, runtime.time.monotonic() + 30
    )

    assert sorted(str(path.relative_to(root)) for path in root.rglob("*")) == before


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
    assert STEPS["Check dependency setup capacity"]["run"].strip() == (
        "python3 backend/scripts/notification_runtime.py prepare"
    )
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
    assert maintenance["run"].strip() == "python3 scripts/notification_runtime.py maintain"
    assert maintenance["if"].removeprefix("${{").removesuffix("}}").strip() == "always()"
