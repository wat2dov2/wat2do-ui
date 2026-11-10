"""Exercise the notification workflow's routing, payload handling, binary setup and its pinned
GitHub expression validator."""

import hashlib
import json
import os
import re
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


@pytest.fixture
def runner(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    for name, value in {
        "GITHUB_ENV": tmp_path / "github-env",
        "GITHUB_OUTPUT": tmp_path / "github-output",
        "DATA_API_KEY": "PRIVATE_CREDENTIAL",
    }.items():
        monkeypatch.setenv(name, str(value))
    monkeypatch.delenv("NOTIFICATION_JSON", raising=False)
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
    monkeypatch.setenv("INTENDED_RECIPIENT_ID", "")
    monkeypatch.setenv("TARGET_SCHOOL", "")
    result = run_step("Validate job inputs")
    assert result.returncode == 1
    assert "Notification routing is missing" in result.stderr
    assert "PRIVATE_" not in result.stdout + result.stderr


ROUTE_STEP = WORKFLOW["jobs"]["route"]["steps"][0]
# The categories the Rust handler records (ACTIONABLE_CATEGORIES); it ignores every other one.
PROCESSED_CATEGORIES = ["post", "subscription_daily_digest"]
RECIPIENT_ID = "17841400000000000"


def run_route(monkeypatch, *, category="post", recipient="", school="", manual=False):
    monkeypatch.setenv("MANUAL_RETRIEVAL", "true" if manual else "false")
    monkeypatch.setenv("PUSH_CATEGORY", category)
    monkeypatch.setenv("INTENDED_RECIPIENT_ID", recipient)
    monkeypatch.setenv("TARGET_SCHOOL", school)
    return subprocess.run(
        ["bash", "-e", "-c", ROUTE_STEP["run"]],
        capture_output=True,
        text=True,
        check=False,
        timeout=5,
    )


@pytest.mark.parametrize(
    ("recipient", "school", "routed"),
    [("", "", "false"), (RECIPIENT_ID, "", "true"), ("", "Waterloo", "true")],
)
def test_route_skips_notifications_without_routing(runner, monkeypatch, recipient, school, routed):
    result = run_route(monkeypatch, recipient=recipient, school=school)

    assert result.returncode == 0
    assert output_file("GITHUB_OUTPUT")["routed"] == routed
    assert ("::notice::Skipped" in result.stdout) == (routed == "false")


@pytest.mark.parametrize("category", PROCESSED_CATEGORIES)
def test_route_passes_post_and_digest_notifications(runner, monkeypatch, category):
    result = run_route(monkeypatch, category=category, recipient=RECIPIENT_ID)

    assert result.returncode == 0
    assert output_file("GITHUB_OUTPUT")["routed"] == "true"
    assert not result.stdout + result.stderr


@pytest.mark.parametrize(
    "category",
    [
        "direct_v2_text",
        "direct_v2_media_share",
        "direct_v2_clips_share",
        "suggested_close_friend",
        "Post",
        "",
    ],
)
def test_route_ends_every_other_category_naming_only_the_category(runner, monkeypatch, category):
    result = run_route(monkeypatch, category=category, recipient=RECIPIENT_ID)

    assert result.returncode == 0
    assert output_file("GITHUB_OUTPUT")["routed"] == "false"
    assert result.stdout == (
        f"::notice::Skipped a {category or 'uncategorized'} notification; "
        "only post and subscription_daily_digest notifications are processed.\n"
    )
    assert not result.stderr


def test_a_manual_retrieval_carries_no_category_and_is_routed(runner, monkeypatch):
    result = run_route(monkeypatch, category="", school="uwaterloo", manual=True)

    assert result.returncode == 0
    assert output_file("GITHUB_OUTPUT")["routed"] == "true"
    assert not result.stdout + result.stderr


def test_route_reads_the_category_from_where_it_reads_the_recipient():
    recipient = ROUTE_STEP["env"]["INTENDED_RECIPIENT_ID"]
    category = ROUTE_STEP["env"]["PUSH_CATEGORY"]

    assert category == recipient.replace(
        "github.event.client_payload.intended_recipient_id || ", ""
    ).replace("intended_recipient_id", "push_category")
    assert ROUTE_STEP["env"]["MANUAL_RETRIEVAL"] == (
        "${{ github.event_name == 'workflow_dispatch' && !inputs.notification_payload }}"
    )


def test_the_workflow_processes_exactly_the_categories_the_binary_records():
    handler = (REPO_ROOT / "rust/src/instagram_notifications/process_notification.rs").read_text()
    actionable = re.search(r"const ACTIONABLE_CATEGORIES: \[&str; \d+\] = \[(.*?)\];", handler)
    assert actionable and json.loads(f"[{actionable.group(1)}]") == PROCESSED_CATEGORIES

    for category in PROCESSED_CATEGORIES:
        assert f'"$PUSH_CATEGORY" != {category}' in ROUTE_STEP["run"]
    listed = f"contains(fromJSON('{json.dumps(PROCESSED_CATEGORIES, separators=(',', ':'))}'), "
    assert WORKFLOW["run-name"].count(listed) == 2


def test_only_processed_notifications_are_named_by_their_title():
    # A direct message's android.title is its sender.
    clauses = [line.strip() for line in WORKFLOW["run-name"].splitlines()]
    titled = [clause for clause in clauses if "android.title" in clause]

    assert len(titled) == 2
    assert all(clause.startswith('contains(fromJSON(\'["post",') for clause in titled)
    assert "android.text" not in WORKFLOW["run-name"]
    assert "format('Skipped {0} notification', " in WORKFLOW["run-name"]


def env_blocks():
    yield "workflow", WORKFLOW.get("env", {})
    for job_name, job in WORKFLOW["jobs"].items():
        yield job_name, job.get("env", {})
        for step in job["steps"]:
            yield f"{job_name}: {step.get('name', step.get('id'))}", step.get("env", {})


def test_no_env_block_carries_the_notification_payload():
    # GitHub prints every env: value in each step's log, and these logs are public.
    for owner, env in env_blocks():
        for name, value in env.items():
            if "notification_dict" in value or "notification_payload" in value:
                assert name in {"MANUAL_RETRIEVAL", "PUSH_CATEGORY", "INTENDED_RECIPIENT_ID"}, (
                    owner,
                    name,
                )
            # No whole payload, and none of the Android extras (android.title, android.text).
            assert "toJSON" not in value and "['android." not in value, (owner, name)
            assert name != "NOTIFICATION_JSON", owner


def test_no_step_stores_or_uploads_the_notification_payload():
    steps = [step for job in WORKFLOW["jobs"].values() for step in job["steps"]]

    assert not any("artifact" in step.get("uses", "") for step in steps)
    readers = [step.get("name") for step in steps if "GITHUB_EVENT_PATH" in step.get("run", "")]
    assert readers == ["Process the Instagram account"]


@pytest.fixture
def fake_binary(runner, monkeypatch):
    """A notification binary that records its arguments and NOTIFICATION_JSON, printing nothing."""
    binary = runner / "wat2do-browser"
    binary.write_text(
        "#!/bin/sh\n"
        'printf "%s\\n" "$*" > "$BINARY_ARGUMENTS"\n'
        'printf "%s" "${NOTIFICATION_JSON-unset}" > "$BINARY_PAYLOAD"\n'
    )
    binary.chmod(0o755)
    (runner / "backend").mkdir()
    monkeypatch.setenv("NOTIFICATION_BINARY", str(binary))
    monkeypatch.setenv("BINARY_ARGUMENTS", str(runner / "arguments"))
    monkeypatch.setenv("BINARY_PAYLOAD", str(runner / "payload"))
    return runner


def process_event(runner, monkeypatch, event):
    """Run the processing step on a GitHub event: its output, the binary's arguments and payload."""
    event_path = runner / "event.json"
    event_path.write_text(json.dumps(event))
    monkeypatch.setenv("GITHUB_EVENT_PATH", str(event_path))
    result = run_step("Process the Instagram account")
    assert result.returncode == 0, result.stderr
    return (
        result.stdout + result.stderr,
        (runner / "arguments").read_text().strip(),
        (runner / "payload").read_text(),
    )


def notification(category):
    return {
        "android.title": "PRIVATE_SENDER",
        "android.text": "PRIVATE_MESSAGE_TEXT",
        "android.subText": "wat2do.uwaterloo",
        "android.progress": 0,
        "com.instagram.android.igns.logging.push_category": category,
        "com.instagram.android.igns.logging.intended_recipient_id": RECIPIENT_ID,
    }


def test_a_forwarded_notification_reaches_only_the_binary(fake_binary, monkeypatch):
    payload = notification("post")

    output, arguments, received = process_event(
        fake_binary, monkeypatch, {"client_payload": {"notification_dict": payload}}
    )

    assert arguments == "process-notification"
    assert json.loads(received) == payload
    assert "PRIVATE_" not in output


def test_a_pasted_notification_reaches_the_binary_unchanged(fake_binary, monkeypatch):
    payload = json.dumps(notification("subscription_daily_digest"), indent=2)

    output, arguments, received = process_event(
        fake_binary,
        monkeypatch,
        {"inputs": {"poster_id": "", "school": "", "notification_payload": payload}},
    )

    assert arguments == "process-notification"
    assert received == payload
    assert "PRIVATE_" not in output


def test_a_manual_handle_is_retrieved_without_a_payload(fake_binary, monkeypatch):
    for name, value in {
        "TARGET_SCHOOL": "uwaterloo",
        "POSTER_ID": "uwcsclub",
        "CUTOFF_DAYS": "1825",
    }.items():
        monkeypatch.setenv(name, value)

    output, arguments, received = process_event(
        fake_binary,
        monkeypatch,
        {"inputs": {"poster_id": "uwcsclub", "school": "uwaterloo", "notification_payload": ""}},
    )

    assert arguments == "retrieve --school uwaterloo --url uwcsclub --cutoff-days 1825"
    assert received == "unset"
    assert (
        output == "Queued uwcsclub for ingestion; the Mac's processor picks it up within seconds.\n"
    )


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
        "Build notification binary",
        "Read database configuration",
        "Process the Instagram account",
    ]
    assert [name for name in names if name in order] == order
    # The Mac mini hosts the database, so every notification runs on its runner,
    # which keeps one incremental build of the binary in its tool cache.
    assert JOB["runs-on"] == ["self-hosted", "wat2do-macmini-browser"]
    assert STEPS["Read notification controls"]["run"].strip() == (
        "bash scripts/notification-binary.sh controls"
    )
    build = STEPS["Build notification binary"]
    assert build["run"].strip() == "bash scripts/notification-binary.sh ensure"
    assert build["timeout-minutes"] == (
        "${{ fromJSON(steps.controls.outputs.build_timeout_minutes) }}"
    )
    assert "if" not in build and "env" not in build
    process = STEPS["Process the Instagram account"]
    assert process["timeout-minutes"] == (
        "${{ fromJSON(steps.controls.outputs.process_timeout_minutes) }}"
    )
    assert '"$NOTIFICATION_BINARY" process-notification' in process["run"]
    assert '"$NOTIFICATION_BINARY" retrieve' in process["run"]
    assert not any("uv" in (name or "").lower() or "Python" in (name or "") for name in names)
    # No credential is in the environment while the binary is built.
    assert "secrets." not in json.dumps(JOB["env"])
    assert "DATABASE_URL" not in json.dumps(JOB["env"])
    # The job reads DATABASE_URL from the Mac's production settings; no repository
    # secret or cloud credential reaches it.
    assert "secrets." not in json.dumps(JOB)
    assert "id-token" not in json.dumps(JOB)
    assert "wat2do-data/config/backend.env" in STEPS["Read database configuration"]["run"]
    for step in JOB["steps"]:
        uses = step.get("uses", "")
        if uses:
            assert len(uses.split("@", 1)[1]) == 40, uses


def test_database_url_is_masked_before_it_reaches_the_environment():
    run = STEPS["Read database configuration"]["run"]
    assert run.index('echo "::add-mask::$database_url"') < run.index(
        'echo "DATABASE_URL=$database_url" >> "$GITHUB_ENV"'
    )
