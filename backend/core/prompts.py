"""Agent prompts, read from the Mac's local prompts folder on every run.

No prompt lives in this (public) repository: each one is a file in
``WAT2DO_PROMPTS_DIR`` (by default ``~/wat2do-data/prompts``, its own local git
repository), named by its path there, such as ``outreach/pitch_prompt.md``. A
run reads its prompt when it starts, so an edit applies on the very next run
with no restart or deploy, and a missing file fails that run instead of falling
back to an old copy. The tests read ``tests/fixtures/prompts`` instead.
The Rust services read the same folder (``rust/src/prompts.rs``).
"""

import os
from collections.abc import Mapping
from pathlib import Path

DIR_VARIABLE = "WAT2DO_PROMPTS_DIR"
DEFAULT_DIR = Path.home() / "wat2do-data/prompts"


def prompts_dir() -> Path:
    """The prompts folder: ``WAT2DO_PROMPTS_DIR``, else ``~/wat2do-data/prompts``."""
    return Path(os.environ.get(DIR_VARIABLE) or DEFAULT_DIR)


def read_prompt(name: str) -> str:
    """The prompt ``name`` (a path inside the folder) as it is now."""
    path = prompts_dir() / name
    try:
        return path.read_text(encoding="utf-8")
    except OSError as error:
        raise RuntimeError(f"could not read the prompt {path}: {error}") from error


def render_prompt(name: str, values: Mapping[str, str]) -> str:
    """The prompt ``name`` with each ``{{key}}`` replaced by its value, in order."""
    prompt = read_prompt(name)
    for key, value in values.items():
        prompt = prompt.replace("{{" + key + "}}", value)
    return prompt
