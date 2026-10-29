from types import SimpleNamespace

import httpx

from schemas.outreach import FoundClubEmail
from services.claude_code import ClaudeCodeError
from services.outreach import finder

CLUB = {
    "club_id": 10,
    "club_name": "Board Games Club",
    "club_page": "https://clubs.example.ca/board-games",
    "school_name": "University of Waterloo",
}
PAGES = {
    # The directory prints its own address on every club's page.
    "https://clubs.example.ca/board-games": (
        '<a href="mailto:BoardGames@Example.ca">Email</a> help@clubs.example.ca '
        "logo@2x.png noreply@clubs.example.ca"
    ),
    "https://clubs.example.ca/chess": "chess@example.ca help@clubs.example.ca",
    "https://clubs.example.ca/taken": "used@example.ca help@clubs.example.ca",
    "https://clubs.example.ca/empty": "help@clubs.example.ca",
    "https://club.example.org/team": "<p>Reach us at games [at] example [dot] org</p>",
    "https://other.example.org/about": "<p>No address here.</p>",
}


def _page(url, **_kwargs):
    if url not in PAGES:
        raise httpx.ConnectError("offline")
    return SimpleNamespace(status_code=200, text=PAGES[url])


def test_each_new_club_keeps_only_the_address_its_page_shows_as_its_own(monkeypatch):
    monkeypatch.setattr(finder.httpx, "get", _page)
    saved = []
    monkeypatch.setattr(
        finder.service, "save_page_search", lambda club_id, found: saved.append((club_id, found))
    )
    clubs = [
        {"club_id": 1, "club_page": "https://clubs.example.ca/board-games"},
        {"club_id": 2, "club_page": "https://clubs.example.ca/chess"},
        {"club_id": 3, "club_page": "https://clubs.example.ca/taken"},
        {"club_id": 4, "club_page": "https://clubs.example.ca/empty"},
        {"club_id": 5, "club_page": "http://clubs.example.ca/plain"},
        {"club_id": 6, "club_page": "https://www.instagram.com/boardgames/"},
        {"club_id": 7, "club_page": None},
    ]
    taken = {"used@example.ca"}

    assert finder._search_club_pages(clubs, taken) == 2

    assert saved == [
        (1, FoundClubEmail(email="boardgames@example.ca", source_url=clubs[0]["club_page"])),
        (2, FoundClubEmail(email="chess@example.ca", source_url=clubs[1]["club_page"])),
        (3, None),
        (4, None),
        (5, None),
        (6, None),
        (7, None),
    ]
    assert {"boardgames@example.ca", "chess@example.ca"} <= taken


def test_research_keeps_an_email_only_when_the_cited_page_prints_it(monkeypatch):
    prompts = []
    answers = iter(
        [
            {"email": "Games@Example.org", "source_url": "https://club.example.org/team"},
            {"email": "guessed@example.org", "source_url": "https://other.example.org/about"},
            {"email": "dead@example.org", "source_url": "https://gone.example.com/"},
            {"email": None, "source_url": None},
            {"email": "not-an-email", "source_url": "https://club.example.org/team"},
        ]
    )

    def run_agent(prompt, **kwargs):
        prompts.append((prompt, kwargs))
        return next(answers)

    monkeypatch.setattr(finder, "run_agent", run_agent)
    monkeypatch.setattr(finder.httpx, "get", _page)

    found = [finder.research(CLUB) for _ in range(5)]

    assert found == [
        FoundClubEmail(email="games@example.org", source_url="https://club.example.org/team"),
        None,
        None,
        None,
        None,
    ]
    prompt, kwargs = prompts[0]
    assert kwargs["tools"] == ("WebSearch", "WebFetch") == kwargs["allowed_tools"]
    assert "Board Games Club" in prompt and "University of Waterloo" in prompt
    assert CLUB["club_page"] in prompt
    assert "{{" not in prompt


def test_sweep_reads_new_pages_researches_the_rest_and_reports(monkeypatch):
    monkeypatch.setattr(finder, "remove_leftovers", lambda _prefix: None)
    monkeypatch.setattr(finder.service, "mark_claimed", lambda: 2)
    monkeypatch.setattr(finder.service, "emails_in_use", lambda: {"used@example.org"})
    monkeypatch.setattr(finder.service, "new_clubs", lambda limit: [{"club_id": 1}])
    monkeypatch.setattr(finder, "_search_club_pages", lambda clubs, taken: len(clubs))
    research = [{**CLUB, "club_id": club_id} for club_id in (10, 11, 12, 13)]
    asked = []
    monkeypatch.setattr(
        finder.service,
        "clubs_to_research",
        lambda limit, searched_before: asked.append(limit) or research,
    )
    answers = {
        10: FoundClubEmail(email="games@example.org", source_url="https://club.example.org/team"),
        11: None,
        12: FoundClubEmail(email="used@example.org", source_url="https://club.example.org/team"),
    }

    def research_club(club):
        if club["club_id"] == 13:
            raise ClaudeCodeError("timed out")
        return answers[club["club_id"]]

    monkeypatch.setattr(finder, "research", research_club)
    saved = []
    monkeypatch.setattr(
        finder.service, "save_research", lambda club_id, found: saved.append((club_id, found))
    )

    result = finder.sweep()

    assert asked == [finder.CONTROL.research_per_sweep]
    # A failed search is tried again later; an address another club has is never reused.
    assert saved == [(10, answers[10]), (11, None), (12, None)]
    assert result == {
        "claimed": 2,
        "page_emails": 1,
        "researched": 3,
        "research_emails": 1,
        "research_failed": 1,
    }
