import json
import re
import subprocess
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace

import pytest

from core.tables import EVENTS, POSITIONS
from services import claude_code
from services.ingestion import agent as module
from services.scraper.org_resolve import ResolvedClub

_DIRECTORY_URL = "https://clubs.example.edu/events/123"
_POSTED = datetime(2026, 10, 15, 15, tzinfo=UTC)
_SCHOOL = SimpleNamespace(slug="uwaterloo", id=7)
_POST = {
    "url": "https://www.instagram.com/p/NEW/",
    "caption": "Drop-in jam this Wednesday Oct 21 is in AL 116!",
    "ownerUsername": "UWImprovisation",
    "coauthors": [{"username": "@yourwusa"}, "uwimprovisation"],
    "timestamp": "2026-10-15T15:00:00Z",
    "images": ["https://cdn.instagram.com/a.jpg"],
}


@pytest.fixture
def run(monkeypatch, tmp_path):
    """Run ``ingest`` with storage, club resolution and the database replaced."""
    state = SimpleNamespace(
        calls=[], drains=[], files={}, result=None, resolved=[], removed=[], outcome="added"
    )
    monkeypatch.setattr(claude_code, "remove_run_folder", state.removed.append)
    monkeypatch.setattr(module, "already_imported", lambda _url: False)
    monkeypatch.setattr(module.school_service, "get_school", lambda slug: _SCHOOL)
    monkeypatch.setattr(module, "resolve_school_timezone", lambda slug: "America/Toronto")
    monkeypatch.setattr(module, "current_semester_end", lambda slug, now: "2026-12-22")
    monkeypatch.setattr(module, "campus_season_prompt", lambda slug: "CAMPUS SEASONS")
    monkeypatch.setattr(module, "fetch_image", lambda url, **_: (b"jpg", "image/jpeg"))
    monkeypatch.setattr(
        module,
        "_store_chosen_posters",
        lambda token, images: state.drains.append(("posters", len(images))),
    )
    monkeypatch.setattr(
        module,
        "_cover_posterless_events",
        lambda url, images, *, since: state.drains.append(("cover", url, len(images))),
    )

    def resolve(**kwargs):
        state.resolved.append(kwargs)
        return ResolvedClub(club_id=6805, club_name="Improv Club, UW", ig_handle="uwimprovisation")

    monkeypatch.setattr(module, "resolve_club_for_scrape", resolve)

    monkeypatch.setattr(module.changes, "drain", lambda: state.drains.append("drain"))
    monkeypatch.setattr(
        module.changes,
        "stamp_new_rows",
        lambda url, *, caption, posted_at, since: state.drains.append(
            ("stamp", url, caption, posted_at)
        ),
    )
    monkeypatch.setattr(claude_code.shutil, "which", lambda name: f"/usr/local/bin/{name}")
    monkeypatch.setattr(
        module.settings,
        "ingest_agent_database_url",
        "postgresql://wat2do_ingest_agent.ref:s%40cret@pooler.example.com:5432/postgres",
    )

    def fake_run(args, **kwargs):
        state.calls.append((args, kwargs))
        state.files = {path.name for path in Path(kwargs["cwd"]).iterdir()}
        if isinstance(state.result, BaseException):
            raise state.result
        answer = {"outcome": state.outcome, "summary": "Inserted event 1"}
        return state.result or subprocess.CompletedProcess(
            args, 0, stdout=json.dumps({"structured_output": answer})
        )

    monkeypatch.setattr(claude_code.subprocess, "run", fake_run)
    return state


def test_ingest_runs_haiku_with_psql_only_then_settles_its_changes(run):
    assert module.ingest(dict(_POST), school="uwaterloo") is True

    [(args, kwargs)] = run.calls
    assert args[:2] == ["/usr/local/bin/claude", "-p"]
    assert args[args.index("--model") + 1] == module.CONTROL.model
    assert args[args.index("--tools") + 1] == "Read,Bash"
    allowed = args[args.index("--allowedTools") + 1 : args.index("--permission-mode")]
    assert allowed == ["Read(./**)", "Bash(psql:*)"]
    assert args[args.index("--permission-mode") + 1] == "dontAsk"
    assert "--no-session-persistence" in args
    assert json.loads(args[args.index("--json-schema") + 1]) == module.OUTCOME_SCHEMA
    assert kwargs["timeout"] == module.CONTROL.model_timeout_seconds
    assert run.files == {"image-0.jpg"}
    # Claude Code's folder for this run never outlives it.
    assert run.removed == [kwargs["cwd"]]
    # New rows from this source get its caption, then every change settles.
    assert run.drains == [
        ("posters", 1),
        ("cover", _POST["url"], 1),
        ("stamp", _POST["url"], _POST["caption"], _POSTED),
        "drain",
    ]


def test_ingest_gives_the_agent_a_scoped_login_and_no_application_secrets(run, monkeypatch):
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "service-key")
    module.ingest(dict(_POST), school="uwaterloo")

    environment = run.calls[0][1]["env"]
    assert "SUPABASE_SECRET_KEY" not in environment
    assert environment["PGUSER"] == "wat2do_ingest_agent.ref"
    assert environment["PGPASSWORD"] == "s@cret"
    assert environment["PGHOST"] == "pooler.example.com"
    assert environment["PGSSLMODE"] == "require"


def test_ingest_renders_every_prompt_placeholder(run):
    module.ingest(dict(_POST), school="uwaterloo")

    prompt = run.calls[0][1]["input"]
    assert "{{" not in prompt
    assert _POST["caption"] in prompt
    assert "Source URL: https://www.instagram.com/p/NEW/" in prompt
    assert "ingestion_source = 'instagram_scraper'" in prompt
    assert "schools.id = 7" in prompt
    assert "Improv Club, UW (clubs.id = 6805, Instagram @uwimprovisation)" in prompt
    assert "Other accounts on the post: @yourwusa" in prompt
    assert re.search(
        r"Image 0: \./image-0\.jpg, poster reference `pending:[0-9a-f]{12}/image-0`", prompt
    )
    assert "local timezone America/Toronto" in prompt
    assert "Current semester ends: 2026-12-22" in prompt


def test_ingest_lets_directory_pages_fall_back_to_the_publishing_club(run):
    page = {"url": "https://wusa.ca/event/jam/", "text": "Jam night", "images": []}
    module.ingest(page, school="uwaterloo", publisher_ig="yourwusa")

    assert run.resolved == [
        {
            "ig_handle": "yourwusa",
            "school": "uwaterloo",
            "club_name": None,
            "create_stub_if_missing": False,
        }
    ]
    prompt = run.calls[0][1]["input"]
    assert "ingestion_source = 'directory'" in prompt
    assert module.DIRECTORY_NOTE in prompt
    assert "Images (read every one" in prompt and "(no images)" in prompt


def test_ingest_still_drains_when_the_agent_fails(run):
    run.result = subprocess.CompletedProcess([], 1, stdout="")

    with pytest.raises(module.AgentError, match="exit 1"):
        module.ingest(dict(_POST), school="uwaterloo")
    assert run.drains == [
        ("posters", 1),
        ("cover", _POST["url"], 1),
        ("stamp", _POST["url"], _POST["caption"], _POSTED),
        "drain",
    ]


def test_ingest_skips_sources_already_listed(run, monkeypatch):
    monkeypatch.setattr(module, "already_imported", lambda _url: True)
    assert module.ingest(dict(_POST), school="uwaterloo") is True
    assert run.calls == [] and run.drains == []


def test_ingest_reports_a_source_that_changed_nothing(run):
    run.outcome = "nothing"
    assert module.ingest(dict(_POST), school="uwaterloo") is False
    assert module.DIRECTORY_NOTE not in run.calls[0][1]["input"]


def test_an_agent_without_an_outcome_fails_and_still_cleans_up(run):
    run.result = subprocess.CompletedProcess([], 0, stdout="Inserted event 1")

    with pytest.raises(module.AgentError, match="gave no answer"):
        module.ingest(dict(_POST), school="uwaterloo")
    assert run.removed and run.drains[-1] == "drain"


def test_ingest_requires_the_scoped_login(run, monkeypatch):
    monkeypatch.setattr(module.settings, "ingest_agent_database_url", "")
    with pytest.raises(module.AgentError, match="INGEST_AGENT_DATABASE_URL"):
        module.ingest(dict(_POST), school="uwaterloo")


def test_candidate_handles_puts_the_owner_first_once():
    assert module.candidate_handles(_POST) == ["uwimprovisation", "yourwusa"]


def test_extract_image_urls_carousel_via_images_field():
    post = {
        "images": [
            {"url": "https://cdn/a.jpg"},
            {"url": "https://cdn/b.jpg"},
        ],
    }
    assert module.image_urls(post) == ["https://cdn/a.jpg", "https://cdn/b.jpg"]


def test_extract_image_urls_falls_back_to_child_posts():
    post = {
        "images": [],
        "childPosts": [
            {"displayUrl": "https://cdn/x.jpg"},
            {"displayUrl": "https://cdn/y.jpg"},
        ],
    }
    assert module.image_urls(post) == ["https://cdn/x.jpg", "https://cdn/y.jpg"]


def test_extract_image_urls_falls_back_to_display_url():
    post = {"displayUrl": "https://cdn/single.jpg"}
    assert module.image_urls(post) == ["https://cdn/single.jpg"]


def test_extract_image_urls_returns_empty_list_when_no_images():
    assert module.image_urls({"caption": "no images"}) == []


@pytest.mark.parametrize(
    ("url", "shortcodes", "event_urls", "position_urls", "expected"),
    [
        pytest.param("https://www.instagram.com/p/SEEN/", {"SEEN"}, set(), set(), True, id="seen"),
        pytest.param("https://instagram.com/reel/NEW/", set(), set(), set(), False, id="new-reel"),
        pytest.param(_DIRECTORY_URL, set(), {_DIRECTORY_URL}, set(), True, id="directory-event"),
        pytest.param(_DIRECTORY_URL, set(), set(), {_DIRECTORY_URL}, True, id="directory-position"),
        pytest.param(_DIRECTORY_URL, {"123"}, set(), set(), False, id="directory-new"),
    ],
)
def test_already_imported_checks_the_source_identity(
    monkeypatch, url, shortcodes, event_urls, position_urls, expected
):
    shortcode_lookups = []
    url_lookups = []

    def existing_shortcodes(requested):
        shortcode_lookups.append(requested)
        return requested & shortcodes

    def existing_urls(requested, *, table=EVENTS):
        url_lookups.append((requested, table))
        return requested & (position_urls if table == POSITIONS else event_urls)

    monkeypatch.setattr(module, "existing_shortcodes", existing_shortcodes)
    monkeypatch.setattr(module, "existing_urls", existing_urls)

    assert module.already_imported(url) is expected
    if "instagram.com" in url:
        assert len(shortcode_lookups) == 1
        assert url_lookups == []
    else:
        assert shortcode_lookups == []
        assert url_lookups[0] == ({url}, EVENTS)


def test_only_the_posters_the_agent_chose_are_stored(monkeypatch):
    stored = []
    updates = []
    rows = {
        EVENTS: [
            {"source_image_url": "pending:abc/image-1"},
            {"source_image_url": "pending:abc/image-1"},
        ],
        POSITIONS: [{"source_image_url": "pending:abc/image-9"}],
    }

    class Query:
        def __init__(self, table):
            self.table, self.payload = table, None

        def select(self, *_):
            return self

        def like(self, column, pattern):
            assert (column, pattern) == ("source_image_url", "pending:abc/image-%")
            return self

        def update(self, payload):
            self.payload = payload
            return self

        def eq(self, column, value):
            updates.append((self.table, self.payload, value))
            return self

        def execute(self):
            return SimpleNamespace(data=rows[self.table] if self.payload is None else [])

    monkeypatch.setattr(module, "get_sb", lambda: SimpleNamespace(table=Query))
    monkeypatch.setattr(
        module,
        "store_image",
        lambda data, content_type: stored.append(data) or "https://wat2do.io/media/p.jpg",
    )
    monkeypatch.setattr(module, "upload_video_from_url", lambda url: f"stored:{url}")
    images = [
        module._Image("image-0.jpg", b"zero", "image/jpeg", None),
        module._Image("image-1.jpg", b"one", "image/jpeg", "https://cdn/video.mp4"),
    ]

    module._store_chosen_posters("abc", images)

    # Image 0 was never chosen, so it is never uploaded; image 1 is uploaded once.
    assert stored == [b"one"]
    assert updates == [
        (
            EVENTS,
            {
                "source_image_url": "https://wat2do.io/media/p.jpg",
                "source_video_url": "stored:https://cdn/video.mp4",
            },
            "pending:abc/image-1",
        ),
        # A reference to an image that does not exist leaves no poster.
        (POSITIONS, {"source_image_url": None}, "pending:abc/image-9"),
    ]


def test_events_left_without_a_poster_get_the_cover_image(monkeypatch):
    stored = []
    calls = []
    since = datetime(2026, 10, 20, 2, tzinfo=UTC)

    class Query:
        def __init__(self, table):
            self.table, self.payload = table, None

        def select(self, *_):
            return self

        def update(self, payload):
            self.payload = payload
            return self

        def __getattr__(self, name):
            def filter_(*args):
                calls.append((name, *args, self.payload))
                return self

            return filter_

        def execute(self):
            return SimpleNamespace(data=[{"id": 1}, {"id": 2}] if self.payload is None else [])

    monkeypatch.setattr(module, "get_sb", lambda: SimpleNamespace(table=Query))
    monkeypatch.setattr(
        module,
        "store_image",
        lambda data, content_type: stored.append(data) or "https://wat2do.io/media/c.jpg",
    )
    images = [
        module._Image("image-0.jpg", b"cover", "image/jpeg", None),
        module._Image("image-1.jpg", b"other", "image/jpeg", None),
    ]

    module._cover_posterless_events(_POST["url"], images, since=since)

    # Only new posterless rows from this source are matched, and the cover is uploaded once.
    assert stored == [b"cover"]
    assert calls == [
        ("eq", "source_url", _POST["url"], None),
        ("gte", "added_at", since.isoformat(), None),
        ("is_", "source_image_url", "null", None),
        ("in_", "id", [1, 2], {"source_image_url": "https://wat2do.io/media/c.jpg"}),
    ]


def test_a_source_without_images_leaves_events_posterless(monkeypatch):
    monkeypatch.setattr(module, "get_sb", lambda: pytest.fail("no images, no queries"))

    module._cover_posterless_events(_POST["url"], [], since=datetime.now(UTC))
