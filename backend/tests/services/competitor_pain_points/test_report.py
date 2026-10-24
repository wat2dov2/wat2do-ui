import json
from pathlib import Path

from schemas.competitor_pain_point import CompetitorPainPointResponse
from services.competitor_pain_points import report

REAL = "https://www.reddit.com/r/uwaterloo/comments/abc/eventbrite_fees/"


def complaint(url=REAL):
    return CompetitorPainPointResponse(
        id="88888888-8888-4888-8888-888888888881",
        competitor="eventbrite",
        source="reddit",
        url=url,
        author="club_treasurer",
        quote="Eventbrite charges us for free tickets.",
        pain_point="Fees on free events",
        audience="organizer",
        found_at="2026-10-21T00:00:00Z",
        status="new",
    )


def suggestion(**changes):
    return {
        "title": "Say clearly that wat2do is free for clubs",
        "priority": "high",
        "problem": "Clubs pay Eventbrite fees on free events.",
        "change": "Add a free-forever line to the club sign-up page.",
        "where": ["wat2do/frontend/src/features/clubs"],
        "complaint_urls": [REAL],
        **changes,
    }


def test_report_reads_complaints_and_code_and_drops_invented_links(monkeypatch):
    saved, seen = [], {}
    monkeypatch.setattr(report.service, "found_since", lambda _since, _limit: [complaint()])
    monkeypatch.setattr(report.service, "save_report", saved.append)

    def run_agent(prompt, **kwargs):
        workdir = Path(kwargs["workdir"])
        seen["complaints"] = json.loads((workdir / "complaints.json").read_text())
        seen["locales"] = sorted(
            path.name for path in (workdir / "wat2do/frontend/src").rglob("locales/*.json")
        )
        seen["routers"] = (workdir / "wat2do/backend/routers/competitor_pain_points.py").exists()
        seen["prompt"], seen["kwargs"] = prompt, kwargs
        return {
            "summary": "Organizers are tired of fees.",
            "themes": [
                {
                    "theme": "Fees",
                    "detail": "Fees on free events.",
                    "competitors": ["Eventbrite"],
                    "complaint_urls": [REAL, "https://invented.example.com/x"],
                }
            ],
            "suggestions": [
                suggestion(),
                suggestion(title="Made up", complaint_urls=["https://invented.example.com/x"]),
                suggestion(priority="urgent"),
            ],
        }

    monkeypatch.setattr(report, "run_agent", run_agent)

    written = report.write_daily_report()

    assert saved == [written]
    assert written.complaint_count == 1 and written.model == report.CONTROL.report_model
    assert written.themes[0].complaint_urls == [REAL]
    # Only the suggestion backed by a real complaint, with a valid priority, is kept.
    assert [s.title for s in written.suggestions] == ["Say clearly that wat2do is free for clubs"]
    assert written.suggestions[0].where == ["frontend/src/features/clubs"]
    assert seen["complaints"][0]["competitor"] == "Eventbrite"
    assert seen["locales"] and set(seen["locales"]) == {"en.json"}
    assert seen["routers"]
    assert "{{" not in seen["prompt"] and "1 complaints" in seen["prompt"]
    assert seen["kwargs"]["tools"] == ("Read", "Grep", "Glob")
    assert seen["kwargs"]["allowed_tools"] == ("Read(./**)", "Grep(./**)", "Glob(./**)")
    assert not Path(seen["kwargs"]["workdir"]).exists()


def test_no_complaints_means_no_report(monkeypatch):
    monkeypatch.setattr(report.service, "found_since", lambda _since, _limit: [])
    monkeypatch.setattr(
        report, "run_agent", lambda *_a, **_k: (_ for _ in ()).throw(AssertionError)
    )
    assert report.write_daily_report() is None
