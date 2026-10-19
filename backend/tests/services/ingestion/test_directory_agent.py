import json
from types import SimpleNamespace

import pytest

from schemas.directory_source import DirectorySource
from services import claude_code
from services.ingestion import directory_agent as module

LISTING_URL = "https://clubs.example.edu/events"
LISTING = b"""<html><a href="https://clubs.example.edu/events/jam">Jam</a>
<a href="https://clubs.example.edu/events/office-hours">Office hours</a>
<a href="https://clubs.example.edu/events/gala">Gala</a>
<a href="https://clubs.example.edu/events/old">Old</a></html>"""


def _source(**overrides) -> DirectorySource:
    fields = {
        "id": 4,
        "school": "upenn",
        "name": "Penn Clubs",
        "url": LISTING_URL,
        "default_club": "Penn Clubs",
        "default_club_ig": "pennclubs",
    }
    return DirectorySource.model_validate({**fields, **overrides})


@pytest.fixture
def directory(monkeypatch):
    state = SimpleNamespace(prompts=[], inserted=[], updated=[], reported=[], handled=[])
    monkeypatch.setattr(
        module.school_service, "get_school", lambda slug: SimpleNamespace(id=7, slug=slug)
    )
    monkeypatch.setattr(module, "resolve_school_timezone", lambda _school: "America/New_York")
    monkeypatch.setattr(module, "_download", lambda url: LISTING)
    monkeypatch.setattr(module, "_handled", lambda source: state.handled)
    monkeypatch.setattr(module, "_listed", lambda *_: {"events": [], "positions": []})

    def run(prompt, workdir):
        state.prompts.append(prompt)
        files = sorted(path.name for path in module.Path(workdir).iterdir())
        assert files == ["handled.json", "listed.json", "listing.html"]
        return state.reported

    monkeypatch.setattr(module, "_run", run)
    monkeypatch.setattr(module, "_insert", state.inserted.append)
    monkeypatch.setattr(module, "_update_ready", lambda url, post: state.updated.append(url))
    return state


def test_agent_findings_become_queue_rows(directory):
    directory.handled = [
        {"url": "https://clubs.example.edu/events/old", "status": "done", "title": "Old"}
    ]
    directory.reported = [
        {
            "url": "https://clubs.example.edu/events/jam",
            "verdict": "event",
            "title": "Jam",
            "starts": ["2026-10-21T19:00", "2026-10-28T19:00"],
            "ends": ["2026-10-21T21:00"],
            "location": "Houston Hall 201",
            "host": "Penn Jazz",
            "description": "Weekly jam.",
            "image_url": "https://clubs.example.edu/jam.png",
        },
        {"url": "https://clubs.example.edu/events/office-hours", "verdict": "not_event"},
        {"url": "https://clubs.example.edu/events/gala", "verdict": "already_listed"},
        {"url": "https://clubs.example.edu/events/old", "verdict": "changed", "title": "Old"},
        # Invented: neither in the listing nor on the directory's site.
        {"url": "https://elsewhere.example.com/x", "verdict": "event", "title": "X"},
        # Already handled and unchanged: never queued again.
        {"url": "https://clubs.example.edu/events/old", "verdict": "event", "title": "Old"},
    ]

    stats = module.scrape_source(_source())

    assert stats == {
        "queued": 1,
        "not_events": 1,
        "already_listed": 1,
        "changed": 1,
        "invented_urls": 1,
    }
    jam, office, gala = directory.inserted
    assert jam["status"] == "ready" and jam["directory_source_id"] == 4
    assert jam["school_id"] == 7 and jam["source"] == "directory"
    assert jam["post"]["images"] == ["https://clubs.example.edu/jam.png"]
    assert "When: 2026-10-21T19:00 to 2026-10-21T21:00; 2026-10-28T19:00" in jam["post"]["text"]
    assert "Where: Houston Hall 201" in jam["post"]["text"]
    assert office == {
        "source_url": "https://clubs.example.edu/events/office-hours",
        "school_id": 7,
        "source": "directory",
        "directory_source_id": 4,
        "status": "not_event",
    }
    assert gala["status"] == "done"
    assert directory.updated == ["https://clubs.example.edu/events/old"]
    prompt = directory.prompts[0]
    assert "Listing: https://clubs.example.edu/events" in prompt
    assert "./listing.html" in prompt
    assert "{{" not in prompt


def test_a_change_is_only_queued_for_a_finished_row(directory):
    directory.handled = [
        {"url": "https://clubs.example.edu/events/jam", "status": "ready"},
        {"url": "https://clubs.example.edu/events/gala", "status": "not_event"},
    ]
    directory.reported = [
        {"url": "https://clubs.example.edu/events/jam", "verdict": "changed", "title": "Jam"},
        {"url": "https://clubs.example.edu/events/gala", "verdict": "changed", "title": "Gala"},
    ]

    assert module.scrape_source(_source()) == {}
    assert directory.updated == [] and directory.inserted == []


def test_one_failing_directory_never_stops_the_others(monkeypatch, tmp_path):
    monkeypatch.setattr(module, "state_directory", lambda: tmp_path)
    monkeypatch.setattr(module, "remove_leftovers", lambda prefix: None)
    monkeypatch.setattr(module, "list_sources", lambda: [_source(id=1), _source(id=2)])

    def scrape(source):
        if source.id == 1:
            raise OSError("unreachable")
        return module.Counter(queued=3)

    monkeypatch.setattr(module, "scrape_source", scrape)

    assert module.scrape_directories() == {"queued": 3, "failed_sources": 1}


def test_agent_runs_without_secrets_and_leaves_no_run_folder(monkeypatch, tmp_path):
    calls = []
    removed = []
    monkeypatch.setattr(claude_code.shutil, "which", lambda _name: "/usr/local/bin/claude")
    monkeypatch.setattr(claude_code, "remove_run_folder", removed.append)
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "never-passed")

    def run(command, **kwargs):
        calls.append((command, kwargs))
        report = {"items": [{"url": "https://clubs.example.edu/events/jam", "verdict": "event"}]}
        return SimpleNamespace(returncode=0, stdout=json.dumps({"structured_output": report}))

    monkeypatch.setattr(claude_code.subprocess, "run", run)

    reported = module._run("prompt", str(tmp_path))

    assert reported == [{"url": "https://clubs.example.edu/events/jam", "verdict": "event"}]
    command, kwargs = calls[0]
    assert command[command.index("--tools") + 1] == "Read,Grep,WebFetch"
    assert "Bash" not in " ".join(command)
    assert "SUPABASE_SECRET_KEY" not in kwargs["env"]
    assert not any(name.startswith("PG") for name in kwargs["env"])
    assert removed == [str(tmp_path)]


def test_agent_without_a_report_fails(monkeypatch, tmp_path):
    monkeypatch.setattr(claude_code.shutil, "which", lambda _name: "/usr/local/bin/claude")
    monkeypatch.setattr(claude_code, "remove_run_folder", lambda _workdir: None)
    monkeypatch.setattr(
        claude_code.subprocess,
        "run",
        lambda *_a, **_k: SimpleNamespace(returncode=0, stdout="oops"),
    )

    with pytest.raises(module.AgentError):
        module._run("prompt", str(tmp_path))


@pytest.mark.parametrize(
    ("listing", "extension"),
    [
        (b"BEGIN:VCALENDAR\nEND:VCALENDAR", ".ics"),
        (b'  {"events": []}', ".json"),
        (b"[]", ".json"),
        (b"<!doctype html><html></html>", ".html"),
    ],
)
def test_listing_file_is_named_for_its_format(listing, extension):
    assert module._extension(listing) == extension
