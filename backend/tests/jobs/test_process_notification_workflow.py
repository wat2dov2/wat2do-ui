"""Exercise the notification workflow's binary setup and its pinned GitHub expression validator."""

import hashlib
import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest
import yaml

from core.controlbox import controlbox

REPO_ROOT = Path(__file__).resolve().parents[3]
WORKFLOW = yaml.safe_load((REPO_ROOT / ".github/workflows/process-notification.yml").read_text())
JOB = WORKFLOW["jobs"]["process-post"]
STEPS = {step["name"]: step for step in JOB["steps"] if "name" in step}
SCRIPT = REPO_ROOT / "scripts/notification-binary.sh"
HOSTED_ONLY = "!contains(needs.route.outputs.runner, 'self-hosted')"


@pytest.fixture
def runner(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    for name, value in {
        "GITHUB_ENV": tmp_path / "github-env",
        "GITHUB_OUTPUT": tmp_path / "github-output",
        "NOTIFICATION_JSON": "PRIVATE_NOTIFICATION_PAYLOAD",
        "DATA_API_KEY": "PRIVATE_CREDENTIAL",
    }.items():
        monkeypatch.setenv(name, str(value))
    return tmp_path


@pytest.fixture
def checkout(runner, monkeypatch):
    """A committed checkout with the script, its controls and a rust/ tree."""
    repository = runner / "checkout"
    (repository / "scripts").mkdir(parents=True)
    shutil.copy2(SCRIPT, repository / "scripts" / SCRIPT.name)
    controls = repository / "backend" / "controlbox"
    controls.mkdir(parents=True)
    (controls / "notification_workflow.json").write_text(
        json.dumps(controlbox.notification_workflow.model_dump())
    )
    (repository / "rust").mkdir()
    (repository / "rust" / "Cargo.toml").write_text('[package]\nname = "wat2do"\n')
    shutil.copy2(
        REPO_ROOT / "rust/browser-worker-sources.txt",
        repository / "rust/browser-worker-sources.txt",
    )
    git = ["git", "-C", str(repository), "-c", "user.name=t", "-c", "user.email=t@example.com"]
    subprocess.run([*git, "init", "-q"], check=True)
    subprocess.run([*git, "add", "-A"], check=True)
    subprocess.run([*git, "commit", "-qm", "checkout"], check=True)
    monkeypatch.setenv("NOTIFICATION_RUNTIME_ROOT", str(runner / "tool cache" / "runtime"))
    monkeypatch.setenv("TMPDIR", str(runner))
    return repository


@pytest.fixture
def fake_cargo(runner, monkeypatch):
    """A cargo that "builds" a binary reporting the fingerprint it was built with."""
    commands = runner / "commands"
    commands.mkdir()
    cargo = commands / "cargo"
    cargo.write_text(
        "#!/bin/sh\n"
        'printf "%s\\n" "$*" >> "$CARGO_LOG"\n'
        'if [ -n "${CARGO_RESULT:-}" ]; then exit "$CARGO_RESULT"; fi\n'
        'mkdir -p "$CARGO_TARGET_DIR/release"\n'
        'reported="${CARGO_REPORTS:-$(bash "$FINGERPRINT_SCRIPT" fingerprint)}"\n'
        'printf "#!/bin/sh\\necho %s\\n" "$reported" > "$CARGO_TARGET_DIR/release/wat2do-browser"\n'
        'chmod +x "$CARGO_TARGET_DIR/release/wat2do-browser"\n'
    )
    cargo.chmod(0o755)
    monkeypatch.setenv("PATH", f"{commands}{os.pathsep}{os.environ['PATH']}")
    monkeypatch.setenv("CARGO_LOG", str(runner / "cargo-log"))
    # Like rust/build.rs, the fake build records the checkout's fingerprint.
    monkeypatch.setenv("FINGERPRINT_SCRIPT", str(runner / "checkout" / "scripts" / SCRIPT.name))
    return runner / "cargo-log"


def output_file(name):
    path = Path(os.environ[name])
    if not path.exists():
        return {}
    return dict(line.split("=", 1) for line in path.read_text().splitlines())


def script(checkout, operation, **environment):
    return subprocess.run(
        ["bash", str(checkout / "scripts" / SCRIPT.name), operation],
        capture_output=True,
        text=True,
        check=False,
        timeout=30,
        env={**os.environ, **environment},
    )


def fingerprint(checkout):
    """The sha256 of the committed listed sources, tests excluded (see rust/build.rs)."""
    listing = (checkout / "rust/browser-worker-sources.txt").read_text().splitlines()
    paths = [line.strip() for line in listing if line.strip() and not line.startswith("#")]
    tree = subprocess.run(
        ["git", "-C", str(checkout), "ls-tree", "-r", "HEAD", "--", *paths],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    blobs = "".join(f"{line}\n" for line in tree.splitlines() if "/tests/" not in line)
    return hashlib.sha256(blobs.encode()).hexdigest()


def test_prepare_runtime_keeps_one_runtime_per_runner_platform(runner, monkeypatch):
    for name, value in {
        "RUNNER_TOOL_CACHE": runner / "tool cache",
        "RUNNER_OS": "macOS",
        "RUNNER_ARCH": "ARM64",
        "RUNNER_TEMP": runner,
    }.items():
        monkeypatch.setenv(name, str(value))
    result = run_step("Prepare notification runtime")
    assert result.returncode == 0
    assert output_file("GITHUB_ENV") == {
        "NOTIFICATION_RUNTIME_ROOT": str(runner / "tool cache" / "wat2do-notification-macOS-ARM64"),
        "TMPDIR": str(runner),
    }
    assert not result.stdout + result.stderr


def test_controls_export_step_budgets_and_the_source_fingerprint(checkout):
    result = script(checkout, "controls")
    assert result.returncode == 0, result.stderr
    control = controlbox.notification_workflow
    assert output_file("GITHUB_OUTPUT") == {
        "build_timeout_minutes": str(control.build_timeout_minutes),
        "process_timeout_minutes": str(control.process_timeout_minutes),
        "fingerprint": fingerprint(checkout),
    }


def test_a_missing_binary_is_built_from_this_source(checkout, fake_cargo):
    result = script(checkout, "ensure")
    assert result.returncode == 0, result.stderr
    binary = (
        Path(os.environ["NOTIFICATION_RUNTIME_ROOT"])
        / "bin"
        / fingerprint(checkout)
        / "wat2do-browser"
    )
    assert output_file("GITHUB_ENV") == {"NOTIFICATION_BINARY": str(binary)}
    assert subprocess.run(
        [binary, "source-fingerprint"], capture_output=True, text=True
    ).stdout.strip() == (fingerprint(checkout))
    (build,) = fake_cargo.read_text().splitlines()
    assert build.startswith("build --release --locked --quiet --manifest-path ")
    assert build.endswith("rust/Cargo.toml --bin wat2do-browser")


def test_a_binary_built_from_this_source_is_reused_without_building(checkout, fake_cargo):
    assert script(checkout, "ensure").returncode == 0
    Path(os.environ["GITHUB_ENV"]).unlink()
    result = script(checkout, "ensure")
    assert result.returncode == 0
    assert "Reusing the notification binary" in result.stdout
    assert len(fake_cargo.read_text().splitlines()) == 1
    assert "NOTIFICATION_BINARY" in output_file("GITHUB_ENV")


def test_a_binary_from_another_source_is_rebuilt(checkout, fake_cargo):
    assert script(checkout, "ensure", CARGO_REPORTS="an-older-source").returncode != 0
    result = script(checkout, "ensure")
    assert result.returncode == 0, result.stderr
    assert len(fake_cargo.read_text().splitlines()) == 2


def test_the_fingerprint_follows_listed_sources_only(checkout):
    before = script(checkout, "fingerprint").stdout.strip()
    assert before == fingerprint(checkout)
    git = ["git", "-C", str(checkout), "-c", "user.name=t", "-c", "user.email=t@example.com"]
    (checkout / "rust" / "src").mkdir()
    (checkout / "rust" / "src" / "unlisted.rs").write_text("// not part of the worker\n")
    tests = checkout / "rust" / "src" / "instagram_notifications" / "tests"
    tests.mkdir(parents=True)
    (tests / "parity.rs").write_text("// tests never change the fingerprint\n")
    subprocess.run([*git, "add", "-A"], check=True)
    subprocess.run([*git, "commit", "-qm", "unrelated"], check=True)
    assert script(checkout, "fingerprint").stdout.strip() == before
    (checkout / "rust" / "src" / "instagram_notifications" / "worker.rs").write_text("// listed\n")
    subprocess.run([*git, "add", "-A"], check=True)
    subprocess.run([*git, "commit", "-qm", "worker"], check=True)
    assert script(checkout, "fingerprint").stdout.strip() != before


def test_only_the_most_recently_used_builds_are_kept(checkout, fake_cargo):
    controls = checkout / "backend" / "controlbox" / "notification_workflow.json"
    values = json.loads(controls.read_text())
    controls.write_text(json.dumps({**values, "binaries_to_keep": 1}))
    git = ["git", "-C", str(checkout), "-c", "user.name=t", "-c", "user.email=t@example.com"]
    subprocess.run([*git, "commit", "-qam", "keep one build"], check=True)
    assert script(checkout, "ensure").returncode == 0
    first = fingerprint(checkout)
    (checkout / "rust" / "Cargo.toml").write_text('[package]\nname = "wat2do"\nversion = "2.0.0"\n')
    subprocess.run([*git, "commit", "-qam", "new source"], check=True)
    assert script(checkout, "ensure").returncode == 0
    builds = Path(os.environ["NOTIFICATION_RUNTIME_ROOT"]) / "bin"
    assert sorted(path.name for path in builds.iterdir()) == [fingerprint(checkout)]
    assert first != fingerprint(checkout)


def test_a_binary_that_still_does_not_match_fails_before_processing(checkout, fake_cargo):
    result = script(checkout, "ensure", CARGO_REPORTS="an-older-source")
    assert result.returncode == 1
    assert "does not match this checkout's source" in result.stderr
    assert "its media has not been processed" in result.stderr
    assert "NOTIFICATION_BINARY" not in output_file("GITHUB_ENV")


def test_a_failed_build_fails_loudly_and_exports_nothing(checkout, fake_cargo):
    result = script(checkout, "ensure", CARGO_RESULT="101")
    assert result.returncode == 1
    assert "::error::The notification binary could not be built." in result.stderr
    assert "NOTIFICATION_BINARY" not in output_file("GITHUB_ENV")
    assert "PRIVATE_" not in result.stdout + result.stderr


def test_a_runner_without_cargo_fails_loudly(checkout, runner):
    result = script(
        checkout, "ensure", PATH="/usr/bin:/bin", HOME=str(runner / "home without rust")
    )
    assert result.returncode == 1
    assert "cargo is not installed" in result.stderr


def test_low_disk_fails_before_building(checkout, fake_cargo):
    controls = checkout / "backend" / "controlbox" / "notification_workflow.json"
    values = json.loads(controls.read_text())
    controls.write_text(json.dumps({**values, "minimum_free_disk_mb": 10**12}))
    result = script(checkout, "ensure")
    assert result.returncode == 1
    assert "Insufficient disk space to build the notification binary" in result.stderr
    assert not fake_cargo.exists()


def test_an_oversized_build_cache_is_cleared_before_building(checkout, fake_cargo):
    controls = checkout / "backend" / "controlbox" / "notification_workflow.json"
    values = json.loads(controls.read_text())
    controls.write_text(json.dumps({**values, "build_target_max_mb": -1}))
    stale = Path(os.environ["NOTIFICATION_RUNTIME_ROOT"]) / "rust-target" / "stale"
    stale.mkdir(parents=True)
    result = script(checkout, "ensure")
    assert result.returncode == 0, result.stderr
    assert "Cleared the notification build cache" in result.stdout
    assert not stale.exists()


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


def test_missing_routing_fails_without_logging_payload(runner, monkeypatch):
    for name in (
        "AWS_DEPLOY_ROLE_ARN",
        "AWS_RUNTIME_SECRET_ARN",
    ):
        monkeypatch.setenv(name, "configured")
    monkeypatch.setenv("INTENDED_RECIPIENT_ID", "")
    monkeypatch.setenv("TARGET_SCHOOL", "")
    result = run_step("Validate job inputs")
    assert result.returncode == 1
    assert "Notification routing is missing" in result.stderr
    assert "PRIVATE_" not in result.stdout + result.stderr


ROUTE_STEP = WORKFLOW["jobs"]["route"]["steps"][0]


def run_route(monkeypatch, *, recipient="", school="", payload="{}", poster=""):
    monkeypatch.setenv("INTENDED_RECIPIENT_ID", recipient)
    monkeypatch.setenv("TARGET_SCHOOL", school)
    monkeypatch.setenv("NOTIFICATION_JSON", payload)
    monkeypatch.setenv("POSTER_ID", poster)
    return subprocess.run(
        ["bash", "-e", "-c", ROUTE_STEP["run"]],
        capture_output=True,
        text=True,
        check=False,
        timeout=5,
    )


@pytest.mark.parametrize(
    ("recipient", "school", "routed"),
    [("", "", "false"), ("17841400000000000", "", "true"), ("", "Waterloo", "true")],
)
def test_route_skips_notifications_without_routing(runner, monkeypatch, recipient, school, routed):
    result = run_route(
        monkeypatch, recipient=recipient, school=school, payload='{"android.title": null}'
    )

    assert result.returncode == 0
    assert output_file("GITHUB_OUTPUT")["routed"] == routed
    assert ("::notice::Skipped" in result.stdout) == (routed == "false")


def test_processing_runs_only_for_routed_notifications():
    route_env = ROUTE_STEP["env"]
    assert route_env["INTENDED_RECIPIENT_ID"] == JOB["env"]["INTENDED_RECIPIENT_ID"]
    assert route_env["TARGET_SCHOOL"] == JOB["env"]["TARGET_SCHOOL"]
    assert JOB["if"] == "needs.route.outputs.routed == 'true'"
    assert WORKFLOW["jobs"]["route"]["outputs"]["routed"] == "${{ steps.check.outputs.routed }}"


def test_the_binary_is_ready_before_any_notification_is_processed():
    names = [step.get("name") for step in JOB["steps"]]
    order = [
        "Validate job inputs",
        "Read notification controls",
        "Restore notification binary",
        "Set up Rust",
        "Cache Rust dependencies",
        "Build notification binary",
        "Save notification binary",
        "Configure AWS credentials with GitHub OIDC",
        "Read database configuration",
        "Process the Instagram account",
    ]
    assert [name for name in names if name in order] == order
    assert STEPS["Read notification controls"]["run"].strip() == (
        "bash scripts/notification-binary.sh controls"
    )
    build = STEPS["Build notification binary"]
    assert build["run"].strip() == "bash scripts/notification-binary.sh ensure"
    assert build["timeout-minutes"] == (
        "${{ fromJSON(steps.controls.outputs.build_timeout_minutes) }}"
    )
    assert "if" not in build
    # Hosted runners build in the checkout, where the restored dependency cache lives;
    # the Mac keeps its own incremental build in the runner's tool cache.
    assert build["env"]["CARGO_TARGET_DIR"] == (
        "${{ !contains(needs.route.outputs.runner, 'self-hosted') && "
        "format('{0}/rust/target', github.workspace) || '' }}"
    )
    assert STEPS["Cache Rust dependencies"]["with"]["workspaces"] == "rust"
    process = STEPS["Process the Instagram account"]
    assert process["timeout-minutes"] == (
        "${{ fromJSON(steps.controls.outputs.process_timeout_minutes) }}"
    )
    assert '"$NOTIFICATION_BINARY" process-notification' in process["run"]
    assert '"$NOTIFICATION_BINARY" retrieve' in process["run"]
    for name in ("Restore notification binary", "Save notification binary"):
        assert HOSTED_ONLY in STEPS[name]["if"]
        assert STEPS[name]["with"]["key"].endswith("${{ steps.controls.outputs.fingerprint }}")
    for name in ("Set up Rust", "Cache Rust dependencies"):
        assert HOSTED_ONLY in STEPS[name]["if"]
        assert "steps.binary-cache.outputs.cache-hit != 'true'" in STEPS[name]["if"]
    assert not any("uv" in (name or "").lower() or "Python" in (name or "") for name in names)
    # No credential is in the environment while the binary is built.
    assert "secrets." not in json.dumps(JOB["env"])
    assert "DATABASE_URL" not in json.dumps(JOB["env"])
    # The job reads DATABASE_URL from Secrets Manager; no repository secret reaches it.
    assert "secrets." not in json.dumps(JOB)
    for step in JOB["steps"]:
        uses = step.get("uses", "")
        if uses:
            assert len(uses.split("@", 1)[1]) == 40, uses


def test_database_url_is_masked_before_it_reaches_the_environment():
    run = STEPS["Read database configuration"]["run"]
    assert run.index('echo "::add-mask::$database_url"') < run.index(
        'echo "DATABASE_URL=$database_url" >> "$GITHUB_ENV"'
    )
