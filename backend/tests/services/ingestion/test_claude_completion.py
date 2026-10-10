import subprocess
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest

from services.ingestion import claude_completion as module


@pytest.fixture
def claude(monkeypatch):
    """Record each ``claude`` invocation and the files visible in its working directory."""
    state = SimpleNamespace(calls=[], files={}, result=None)
    monkeypatch.setattr(module.shutil, "which", lambda name: f"/usr/local/bin/{name}")

    def run(args, **kwargs):
        state.calls.append((args, kwargs))
        state.files = {path.name: path.read_bytes() for path in Path(kwargs["cwd"]).iterdir()}
        if isinstance(state.result, BaseException):
            raise state.result
        return state.result or subprocess.CompletedProcess(args, 0, stdout='{"ok": true}')

    monkeypatch.setattr(module.subprocess, "run", run)
    return state


@pytest.fixture
def images(monkeypatch):
    """Serve each URL's (status, content-type, body) to image downloads."""
    served: dict[str, tuple[int, str, bytes]] = {}

    def get(url, **kwargs):
        assert kwargs["follow_redirects"] is True
        status, content_type, body = served[url]
        return httpx.Response(
            status,
            headers={"content-type": content_type},
            content=body,
            request=httpx.Request("GET", url),
        )

    monkeypatch.setattr(module.httpx, "get", get)
    return served


def test_runs_an_unsaved_read_only_claude_session_with_the_controlbox_model(claude):
    assert module.claude_completion("System rules", "Extract events.", []) == '{"ok": true}'

    [(args, kwargs)] = claude.calls
    assert args[:2] == ["/usr/local/bin/claude", "-p"]
    assert args[args.index("--model") + 1] == module.CONTROL.model
    assert args[args.index("--system-prompt") + 1] == "System rules"
    assert args[args.index("--tools") + 1] == "Read"
    assert args[args.index("--permission-mode") + 1] == "dontAsk"
    assert args[args.index("--output-format") + 1] == "text"
    assert "--no-session-persistence" in args
    assert "--strict-mcp-config" in args
    assert kwargs["input"] == "Extract events.\n\nRespond with the JSON only."
    assert kwargs["timeout"] == module.CONTROL.model_timeout_seconds
    assert kwargs["capture_output"] is True
    assert kwargs["text"] is True
    assert Path(kwargs["cwd"]).name.startswith("wat2do-ingestion-")
    assert not Path(kwargs["cwd"]).exists()


def test_images_are_downloaded_into_the_session_directory_with_markers(claude, images):
    images["https://cdn/a"] = (200, "image/png; charset=binary", b"png-bytes")
    images["https://cdn/b"] = (200, "text/html", b"<html>")
    images["https://cdn/c"] = (404, "image/jpeg", b"")

    module.claude_completion(
        "System", "Extract.", ["https://cdn/a", "https://cdn/b", "https://cdn/c"]
    )

    [(_args, kwargs)] = claude.calls
    assert claude.files == {"image-0.png": b"png-bytes"}
    assert kwargs["input"] == (
        "Extract.\n\n"
        "Read every available image file below with the Read tool before answering.\n\n"
        "Image 0: ./image-0.png\nImage 1: unavailable\nImage 2: unavailable\n\n"
        "Respond with the JSON only."
    )


def test_image_count_is_capped_by_the_controlbox(claude, images, monkeypatch):
    monkeypatch.setattr(
        module, "CONTROL", module.CONTROL.model_copy(update={"max_images_per_item": 1})
    )
    images["https://cdn/a"] = (200, "image/jpeg", b"jpeg")

    module.claude_completion("System", "Extract.", ["https://cdn/a", "https://cdn/b"])

    assert claude.files == {"image-0.jpg": b"jpeg"}
    assert "Image 1" not in claude.calls[0][1]["input"]


@pytest.mark.parametrize(
    "result",
    [
        subprocess.CompletedProcess([], 1, stdout="partial", stderr="rate limited"),
        subprocess.TimeoutExpired("claude", 240),
        OSError("exec failed"),
    ],
)
def test_failed_session_returns_none(claude, caplog, result):
    claude.result = result

    assert module.claude_completion("System", "Secret caption", []) is None
    assert "Claude extraction call failed" in caplog.text
    assert "Secret caption" not in caplog.text


def test_missing_claude_returns_none(monkeypatch):
    monkeypatch.setattr(module.shutil, "which", lambda _name: None)
    run = pytest.fail
    monkeypatch.setattr(module.subprocess, "run", run)

    assert module.claude_completion("System", "Prompt", []) is None
