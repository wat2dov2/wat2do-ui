"""The agent prompt loader, and (on the Mac only) the live prompts' fit with their stand-ins."""

import re
from pathlib import Path

import pytest

from core.prompts import DEFAULT_DIR, read_prompt, render_prompt

FIXTURE_PROMPTS = Path(__file__).parents[1] / "fixtures/prompts"


def _files(folder: Path) -> set[str]:
    return {
        path.relative_to(folder).as_posix()
        for path in folder.rglob("*")
        if path.is_file() and ".git" not in path.parts and path.name != "README.md"
    }


def _placeholders(name: str, text: str) -> set[str]:
    # The extraction template is a ``str.format`` template; every other prompt uses {{key}}.
    if name == "scraper/extraction_prompt.txt":
        return set(re.findall(r"(?<!\{)\{([a-z_]+)\}(?!\})", text))
    return set(re.findall(r"\{\{([a-z_]+)\}\}", text))


def test_a_prompt_is_read_as_it_is_now(tmp_path, monkeypatch):
    monkeypatch.setenv("WAT2DO_PROMPTS_DIR", str(tmp_path))
    (tmp_path / "agent").mkdir()
    (tmp_path / "agent/prompt.md").write_text("Hello {{name}} at {{school}}")
    assert render_prompt("agent/prompt.md", {"name": "{{school}}", "school": "UW"}) == (
        "Hello UW at UW"
    )
    (tmp_path / "agent/prompt.md").write_text("Edited")
    assert read_prompt("agent/prompt.md") == "Edited"


def test_a_missing_prompt_fails_the_run(tmp_path, monkeypatch):
    monkeypatch.setenv("WAT2DO_PROMPTS_DIR", str(tmp_path))
    with pytest.raises(RuntimeError, match="could not read the prompt"):
        read_prompt("agent/prompt.md")


@pytest.mark.skipif(not DEFAULT_DIR.is_dir(), reason="the prompts live only on the Mac")
def test_the_live_prompts_match_their_test_stand_ins():
    """Every prompt the tests stand in for is on the Mac with the same placeholders,
    so the tests fill exactly what the real prompt needs."""
    assert _files(FIXTURE_PROMPTS) <= _files(DEFAULT_DIR)
    for name in sorted(_files(FIXTURE_PROMPTS)):
        live = (DEFAULT_DIR / name).read_text(encoding="utf-8")
        stand_in = (FIXTURE_PROMPTS / name).read_text(encoding="utf-8")
        assert _placeholders(name, live) == _placeholders(name, stand_in), name
