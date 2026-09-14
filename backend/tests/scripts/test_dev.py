import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace

import pytest


@pytest.fixture
def workflow(monkeypatch):
    path = Path(__file__).resolve().parents[3] / "scripts/dev.py"
    spec = importlib.util.spec_from_file_location("local_dev", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    calls = []

    def run(command, **kwargs):
        calls.append((command, kwargs))
        if command[-3:] == ["config", "--format", "json"]:
            return SimpleNamespace(
                stdout=json.dumps(
                    {
                        "services": {
                            "backend": {"environment": {"EMAIL_PROVIDER_API_KEY": "re_test"}}
                        }
                    }
                )
            )
        return SimpleNamespace(
            stdout=json.dumps(
                {
                    "ANON_KEY": "local-anon",
                    "SERVICE_ROLE_KEY": "local-service",
                    "API_URL": "http://127.0.0.1:54321",
                }
            )
        )

    monkeypatch.setattr(module, "run", run)
    monkeypatch.setattr(module.shutil, "which", lambda name: name)
    return module, calls


def test_dev_uses_local_infrastructure_then_single_seed_then_apps(workflow, monkeypatch, capsys):
    module, calls = workflow
    monkeypatch.setattr("sys.argv", ["dev.py", "dev"])
    module.main()
    commands = [command for command, _ in calls]
    assert commands[2] == ["supabase", "start"]
    assert commands[3] == ["supabase", "migration", "up", "--local"]
    assert commands[4][:3] == ["docker", "exec", "-i"]
    assert calls[4][1]["stdin"].name.endswith("supabase/seed.sql")
    assert commands[-1][-4:] == ["up", "--build", "--detach", "--wait"]
    assert calls[-1][1]["env"]["DEV_SUPABASE_SECRET_KEY"] == "local-service"
    assert calls[-1][1]["env"]["DEV_SUPABASE_JWT_ISSUER"] == "http://127.0.0.1:54321/auth/v1"
    assert "local-service" not in capsys.readouterr().out
    assert not any("reset" in command for command in commands)


@pytest.mark.parametrize("key", [None, "", "   "])
def test_dev_requires_resend_key_before_starting_services(workflow, monkeypatch, key):
    module, calls = workflow
    monkeypatch.setattr("sys.argv", ["dev.py", "dev"])

    def run(command, **kwargs):
        calls.append((command, kwargs))
        environment = {} if key is None else {"EMAIL_PROVIDER_API_KEY": key}
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
    assert len(calls) == 2
    assert calls[-1][0][:3] == ["docker", "exec", "-i"]


def test_stop_preserves_volumes(workflow, monkeypatch):
    module, calls = workflow
    monkeypatch.setattr("sys.argv", ["dev.py", "stop"])
    module.main()
    assert calls[1][0] == [*module.COMPOSE, "down"]
    assert calls[2][0] == ["supabase", "stop"]


def test_reset_requires_explicit_confirmation(workflow, monkeypatch):
    module, calls = workflow
    monkeypatch.setattr("sys.argv", ["dev.py", "reset"])
    monkeypatch.setattr("builtins.input", lambda _: "no")
    with pytest.raises(SystemExit):
        module.main()
    assert len(calls) == 1


def test_confirmed_reset_is_local_only(workflow, monkeypatch):
    module, calls = workflow
    monkeypatch.setattr("sys.argv", ["dev.py", "reset"])
    monkeypatch.setattr("builtins.input", lambda _: "RESET")
    module.main()
    assert calls[-1][0] == ["supabase", "db", "reset", "--local"]
