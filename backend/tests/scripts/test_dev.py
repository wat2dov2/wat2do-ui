import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace

import pytest


@pytest.fixture
def workflow(monkeypatch, tmp_path):
    path = Path(__file__).resolve().parents[3] / "scripts/dev.py"
    spec = importlib.util.spec_from_file_location("local_dev", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    signing_key = tmp_path / "dev-auth-signing-key"
    signing_key.write_text("local-test-key\n")
    monkeypatch.setattr(module, "DEV_SIGNING_KEY", signing_key)
    # main() exports the key for docker compose; undo that after each test.
    monkeypatch.delenv("DEV_AUTH_SIGNING_KEY", raising=False)
    calls = []

    def run(command, **kwargs):
        calls.append((command, kwargs))
        if command[-3:] == ["config", "--format", "json"]:
            return SimpleNamespace(
                stdout=json.dumps(
                    {
                        "services": {
                            "backend": {
                                "environment": {
                                    "AWS_ACCESS_KEY_ID": "AKIATEST",
                                    "AWS_SECRET_ACCESS_KEY": "test-secret",
                                }
                            }
                        }
                    }
                )
            )
        return SimpleNamespace(stdout="")

    monkeypatch.setattr(module, "run", run)
    monkeypatch.setattr(module.shutil, "which", lambda name: name)
    return module, calls


def database_scripts(module, commands):
    """The shell scripts run inside the database container, in order."""
    prefix = [*module.COMPOSE, "exec", "-T", "database", "sh", "-c"]
    return [command[-1] for command in commands if command[:-1] == prefix]


def test_dev_starts_database_then_migrates_and_seeds_before_apps(workflow, monkeypatch):
    module, calls = workflow
    monkeypatch.setattr("sys.argv", ["dev.py", "dev"])
    module.main()
    commands = [command for command, _ in calls]
    assert commands[2] == [*module.COMPOSE, "up", "--build", "--detach", "--wait", "database"]
    scripts = database_scripts(module, commands)
    assert len(scripts) == 3
    assert scripts[0].endswith("-f /workspace/backend/database/local-roles.sql")
    assert scripts[1].endswith("bash /workspace/scripts/migrate-database.sh")
    assert scripts[2].endswith("-f /workspace/backend/database/seed.sql")
    assert commands[-1] == [*module.COMPOSE, "up", "--build", "--detach", "--wait"]
    assert not any("dropdb" in script for script in scripts)
    assert module.os.environ["DEV_AUTH_SIGNING_KEY"] == "local-test-key"


@pytest.mark.parametrize("key", [None, "", "   "])
def test_dev_requires_ses_credentials_before_starting_services(workflow, monkeypatch, key):
    module, calls = workflow
    monkeypatch.setattr("sys.argv", ["dev.py", "dev"])

    def run(command, **kwargs):
        calls.append((command, kwargs))
        environment = {"AWS_ACCESS_KEY_ID": "AKIATEST"}
        if key is not None:
            environment["AWS_SECRET_ACCESS_KEY"] = key
        return SimpleNamespace(
            stdout=json.dumps({"services": {"backend": {"environment": environment}}})
        )

    monkeypatch.setattr(module, "run", run)
    with pytest.raises(SystemExit):
        module.main()
    assert len(calls) == 2
    assert calls[-1][0][-3:] == ["config", "--format", "json"]


def test_seed_does_not_start_or_reset_services(workflow, monkeypatch):
    module, calls = workflow
    monkeypatch.setattr("sys.argv", ["dev.py", "seed"])
    module.main()
    commands = [command for command, _ in calls]
    assert len(commands) == 2
    assert database_scripts(module, commands) == [
        f"{module.PSQL} -f /workspace/backend/database/seed.sql"
    ]


def test_stop_preserves_volumes(workflow, monkeypatch):
    module, calls = workflow
    monkeypatch.setattr("sys.argv", ["dev.py", "stop"])
    module.main()
    assert [command for command, _ in calls[1:]] == [[*module.COMPOSE, "down"]]


def test_db_reset_requires_explicit_confirmation(workflow, monkeypatch):
    module, calls = workflow
    monkeypatch.setattr("sys.argv", ["dev.py", "db-reset"])
    monkeypatch.setattr("builtins.input", lambda _: "no")
    with pytest.raises(SystemExit):
        module.main()
    assert len(calls) == 1


def test_confirmed_db_reset_rebuilds_only_the_local_database(workflow, monkeypatch):
    module, calls = workflow
    monkeypatch.setattr("sys.argv", ["dev.py", "db-reset"])
    monkeypatch.setattr("builtins.input", lambda _: "RESET")
    module.main()
    commands = [command for command, _ in calls]
    assert commands[1] == [*module.COMPOSE, "stop", "data-api", "backend", "frontend"]
    assert commands[2] == [*module.COMPOSE, "up", "--build", "--detach", "--wait", "database"]
    scripts = database_scripts(module, commands)
    assert "dropdb" in scripts[0] and "--force" in scripts[0] and "createdb" in scripts[0]
    assert scripts[1].endswith("local-roles.sql")
    assert scripts[2].endswith("migrate-database.sh")
    assert scripts[3].endswith("seed.sql")
    assert len(commands) == 3 + len(scripts)
