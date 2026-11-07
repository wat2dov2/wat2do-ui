import json
from datetime import date
from pathlib import Path

from schemas.competitor_pain_point import (
    CompetitorPainPointResponse,
    DailyReport,
    PainPointFeature,
)
from services.competitor_pain_points import report

REAL = "https://www.reddit.com/r/uwaterloo/comments/abc/eventbrite_fees/"
PAST = "https://apps.apple.com/ca/app/eventbrite/id487922291?see-all=reviews#past"
OLD = "https://x.com/someone/status/1"
TODAY = date(2026, 10, 21)


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


def feature(**changes):
    return {
        "key": "free-for-clubs",
        "title": "Say clearly that wat2do is free for clubs",
        "problem": "Clubs pay fees on free events.",
        "change": "Add a free-forever line to the club sign-up page.",
        "where": ["wat2do/frontend/src/features/clubs"],
        "audience": "organizer",
        "status": "open",
        "demand": 4,
        "pain": 4,
        "fit": 5,
        "edge": 3,
        "ease": 5,
        "rationale": "Fees come up every week.",
        "competitors": ["Eventbrite"],
        "complaint_urls": [REAL],
        **changes,
    }


def stored(**changes):
    return PainPointFeature.model_validate(
        {
            **feature(where=["frontend/src/features/clubs"]),
            "complaint_urls": [OLD],
            "competitors": ["Luma"],
            "report_count": 3,
            "first_seen": "2026-10-01",
            "last_seen": "2026-10-10",
            **changes,
        }
    )


def test_report_reads_complaints_and_code_and_drops_invented_links(monkeypatch):
    saved, seen = [], {}
    monkeypatch.setattr(report.service, "found_since", lambda _since, _limit: [complaint()])
    monkeypatch.setattr(report.service, "save_report", saved.append)
    monkeypatch.setattr(report.service, "all_features", lambda: [stored()])
    monkeypatch.setattr(
        report.service,
        "recent_reports",
        lambda _limit: [
            DailyReport(
                report_date=date(2026, 10, 20),
                model="claude-opus-5-5",
                complaint_count=4,
                summary="Fees.",
                suggestions=[suggestion(complaint_urls=[PAST])],
            )
        ],
    )
    monkeypatch.setattr(report.service, "save_features", lambda features: saved.append(features))

    def run_agent(prompt, **kwargs):
        workdir = Path(kwargs["workdir"])
        seen["complaints"] = json.loads((workdir / "complaints.json").read_text())
        seen["features"] = json.loads((workdir / "features.json").read_text())
        seen["past"] = json.loads((workdir / "past_suggestions.json").read_text())
        seen["locales"] = sorted(
            path.name for path in (workdir / "wat2do/frontend/src").rglob("locales/*.json")
        )
        seen["routers"] = (
            workdir / "wat2do/rust/src/api/routes/competitor_pain_points.rs"
        ).exists()
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
            "features": [feature(), feature(key="from-the-past", complaint_urls=[PAST])],
        }

    monkeypatch.setattr(report, "run_agent", run_agent)

    written = report.write_daily_report()

    assert saved[0] == written
    assert [f.key for f in saved[1]] == ["free-for-clubs", "from-the-past"]
    assert (
        seen["features"][0]["complaint_count"] == 1 and "complaint_urls" not in seen["features"][0]
    )
    assert seen["past"][0]["report_date"] == "2026-10-20"
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


def test_features_keep_every_link_and_drop_unbacked_new_ones():
    old = stored()
    merged = report._features(
        {
            "features": [
                feature(
                    complaint_urls=[REAL, "https://invented.example.com/x"], competitors=["Posh"]
                ),
                feature(key="made-up", complaint_urls=["https://invented.example.com/x"]),
                feature(key="Bad Key"),
                feature(key="too-good", demand=9),
            ]
        },
        [old],
        {REAL, OLD},
        TODAY,
    )
    assert [f.key for f in merged] == ["free-for-clubs"]
    kept = merged[0]
    assert kept.complaint_urls == [OLD, REAL]
    assert kept.competitors == ["Luma", "Posh"]
    assert kept.where == ["frontend/src/features/clubs"]
    assert (kept.report_count, kept.first_seen, kept.last_seen) == (4, old.first_seen, TODAY)


def test_rescoring_without_new_links_keeps_the_sighting():
    old = stored(complaint_urls=[REAL])
    [kept] = report._features({"features": [feature(status="built", ease=1)]}, [old], {REAL}, TODAY)
    assert (kept.status, kept.ease) == ("built", 1)
    assert (kept.report_count, kept.last_seen) == (3, old.last_seen)


def test_a_new_feature_starts_its_history_today():
    [new] = report._features({"features": [feature()]}, [], {REAL}, TODAY)
    assert (new.report_count, new.first_seen, new.last_seen) == (1, TODAY, TODAY)
