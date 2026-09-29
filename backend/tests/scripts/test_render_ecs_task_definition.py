import json
import subprocess
from pathlib import Path

from core.controlbox import controlbox

REPO_ROOT = Path(__file__).resolve().parents[3]


def test_release_applies_runtime_budget_to_existing_task_without_losing_configuration(tmp_path):
    """A release must fix the active task even before Terraform updates its family."""
    backend = {
        "name": "backend",
        "image": "backend:old",
        "cpu": 256,
        "memoryReservation": 256,
        "environment": [
            {"name": "STORAGE_BUCKET_NAME", "value": "test-media"},
            {"name": "AWS_REGION", "value": "ca-central-1"},
            {"name": "OTHER_BACKEND_SETTING", "value": "keep"},
        ],
        "secrets": [{"name": "TOKEN", "valueFrom": "test-secret-reference"}],
    }
    frontend = {
        "name": "frontend",
        "image": "frontend:old",
        "cpu": 256,
        "memoryReservation": 512,
        "environment": [
            {"name": "NODE_OPTIONS", "value": "--max-old-space-size=256"},
            {"name": "STORAGE_BUCKET_NAME", "value": "old-media"},
            {"name": "AWS_REGION", "value": "old-region"},
            {"name": "BACKEND_API_URL", "value": "http://127.0.0.1:8000"},
        ],
        "healthCheck": {"startPeriod": 20, "command": ["CMD-SHELL", "check-health"]},
        "mountPoints": [{"sourceVolume": "frontend-cache", "containerPath": "/cache"}],
    }
    sidecar = {"name": "unrelated-sidecar", "image": "sidecar:old"}
    source = {
        "taskDefinitionArn": "old-arn",
        "revision": 267,
        "status": "ACTIVE",
        "requiresAttributes": [],
        "compatibilities": ["FARGATE"],
        "registeredAt": "old-time",
        "registeredBy": "old-user",
        "family": "test-app",
        "cpu": "512",
        "memory": "1024",
        "executionRoleArn": "execution-role",
        "taskRoleArn": "task-role",
        "networkMode": "awsvpc",
        "containerDefinitions": [
            backend,
            frontend,
            {"name": "frontend-cache-init", "image": "frontend:old", "memoryReservation": 16},
            sidecar,
        ],
    }
    source_path = tmp_path / "task-definition.json"
    source_path.write_text(json.dumps(source))
    result = subprocess.run(
        [
            "bash",
            str(REPO_ROOT / "scripts/render-ecs-task-definition.sh"),
            str(source_path),
            "frontend@sha256:new",
            "backend@sha256:new",
        ],
        check=True,
        capture_output=True,
        text=True,
        cwd=tmp_path,
    )
    rendered = json.loads(result.stdout)
    runtime = controlbox.ecs_runtime
    assert rendered["cpu"] == str(runtime.task_cpu)
    assert rendered["memory"] == str(runtime.task_memory_mib)
    for key in ("taskDefinitionArn", "revision", "status", "registeredAt", "registeredBy"):
        assert key not in rendered
    assert rendered["executionRoleArn"] == source["executionRoleArn"]
    assert rendered["taskRoleArn"] == source["taskRoleArn"]
    assert rendered["networkMode"] == source["networkMode"]
    containers = {container["name"]: container for container in rendered["containerDefinitions"]}
    assert containers["unrelated-sidecar"] == sidecar
    assert containers["backend"]["image"] == "backend@sha256:new"
    assert containers["backend"]["cpu"] == runtime.backend_cpu
    assert containers["backend"]["memoryReservation"] == runtime.backend_memory_reservation_mib
    assert containers["backend"]["environment"] == backend["environment"]
    assert containers["backend"]["secrets"] == backend["secrets"]
    assert containers["frontend-cache-init"]["image"] == "frontend@sha256:new"
    assert (
        containers["frontend-cache-init"]["memoryReservation"]
        == runtime.cache_init_memory_reservation_mib
    )
    rendered_frontend = containers["frontend"]
    assert rendered_frontend["image"] == "frontend@sha256:new"
    assert rendered_frontend["cpu"] == runtime.frontend_cpu
    assert rendered_frontend["memoryReservation"] == runtime.frontend_memory_reservation_mib
    assert rendered_frontend["mountPoints"] == frontend["mountPoints"]
    assert rendered_frontend["healthCheck"]["command"] == frontend["healthCheck"]["command"]
    assert rendered_frontend["healthCheck"]["startPeriod"] == 300
    environment = {item["name"]: item["value"] for item in rendered_frontend["environment"]}
    assert len(environment) == len(rendered_frontend["environment"])
    assert environment == {
        "NODE_OPTIONS": f"--max-old-space-size={runtime.frontend_heap_mib}",
        "STORAGE_BUCKET_NAME": "test-media",
        "AWS_REGION": "ca-central-1",
        "BACKEND_API_URL": "http://127.0.0.1:8000",
    }
