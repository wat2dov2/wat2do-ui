"""Run Claude Code headless as a scoped local agent and read its structured answer.

Every agent the Mac runs goes through ``run_agent``: a prompt on stdin, only the
named tools, no MCP servers or saved session, and a JSON schema the answer must
match. The agent's folder under ``~/.claude/projects`` is removed after each run.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
from collections.abc import Sequence
from pathlib import Path
from typing import Any


class ClaudeCodeError(RuntimeError):
    """Claude Code did not run, or finished without a structured answer."""


class ClaudeLimited(ClaudeCodeError):
    """Claude turned the run away (HTTP 429) because the account's usage limit is reached.

    Every run fails this way until the limit resets, whatever it was given, so callers
    keep the work for a later try instead of reading the failure as an answer.
    """


def run_agent(
    prompt: str,
    *,
    workdir: str,
    model: str,
    tools: Sequence[str],
    allowed_tools: Sequence[str],
    schema: dict[str, Any],
    timeout: float,
    env: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Run one agent in ``workdir`` and return its answer, which matches ``schema``.

    ``tools`` are the only tools Claude Code loads and ``allowed_tools`` the
    permission rules it may use them under. ``env`` defaults to
    ``claude_environment()``, so an agent sees no application secret unless its
    caller passes one deliberately.
    """
    executable = shutil.which("claude")
    if executable is None:
        raise ClaudeCodeError("Claude Code is not installed")
    try:
        result = subprocess.run(
            [
                executable,
                "-p",
                "--model",
                model,
                "--tools",
                ",".join(tools),
                "--allowedTools",
                *allowed_tools,
                "--permission-mode",
                "dontAsk",
                "--strict-mcp-config",
                "--no-session-persistence",
                "--output-format",
                "json",
                "--json-schema",
                json.dumps(schema),
            ],
            input=prompt,
            cwd=workdir,
            env=claude_environment() if env is None else env,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise ClaudeCodeError(f"failed ({type(exc).__name__})") from None
    finally:
        remove_run_folder(workdir)
    # Claude Code prints its result as JSON even when the run failed.
    try:
        printed = json.loads(result.stdout)
    except ValueError:
        printed = None
    if not isinstance(printed, dict):
        printed = {}
    if printed.get("api_error_status") == 429:
        raise ClaudeLimited(f"hit Claude's usage limit ({printed.get('result') or ''})")
    if result.returncode:
        raise ClaudeCodeError(f"failed (exit {result.returncode})")
    answer = printed.get("structured_output")
    if not isinstance(answer, dict):
        raise ClaudeCodeError("gave no answer")
    return answer


def claude_environment() -> dict[str, str]:
    """Only what Claude Code itself needs; no application secrets."""
    inherited = ("PATH", "HOME", "USER", "LOGNAME", "LANG", "TMPDIR")
    return {name: os.environ[name] for name in inherited if name in os.environ}


def claude_projects() -> Path:
    return Path.home() / ".claude/projects"


def remove_run_folder(workdir: str) -> None:
    """Delete the folder Claude Code keeps for a run, named after its working directory."""
    name = re.sub(r"[^A-Za-z0-9]", "-", os.path.realpath(workdir))
    shutil.rmtree(claude_projects() / name, ignore_errors=True)


def remove_leftovers(prefix: str) -> None:
    """Delete working and Claude Code folders that interrupted runs never cleaned up."""
    leftovers = [
        *Path(tempfile.gettempdir()).glob(f"{prefix}*"),
        *claude_projects().glob(f"*{re.sub(r'[^A-Za-z0-9]', '-', prefix)}*"),
    ]
    for folder in leftovers:
        shutil.rmtree(folder, ignore_errors=True)
