from datetime import date, timedelta
from types import SimpleNamespace

import httpx

from schemas.outreach import OutreachCampaignResponse
from services.claude_code import ClaudeCodeError
from services.outreach import finder

SCHOOL = {"id": 7, "slug": "uwaterloo", "name": "University of Waterloo"}
CAMPAIGN = OutreachCampaignResponse(
    id="99999999-9999-4999-8999-999999999991",
    name="Fall hackathons",
    lead_type="hackathon",
    goal="List every campus hackathon.",
    school_slugs=[],
    status="active",
    created_at="2026-10-22T00:00:00Z",
)
SOON = (date.today() + timedelta(days=20)).isoformat()
GOOD = {
    "event_name": "Example Hacks",
    "event_url": "https://examplehacks.ca/",
    "event_date": SOON,
    "organization": "Example Hacks",
    "contact_name": "Sam",
    "contact_role": "Co-director",
    "email": "Hello@ExampleHacks.ca",
    "source_url": "https://examplehacks.ca/contact",
    "context": "A 36-hour hackathon.",
    "video_script": "Hey Sam...",
    "email_subject": "Example Hacks on Wat2Do",
    "email_body": "Hi Sam...",
    "follow_up": "Hi again...",
}
PAGES = {
    "https://examplehacks.ca/contact": '<a href="mailto:hello@examplehacks.ca">Email us</a>',
    "https://club.example.org/team": "<p>Reach us at events [at] club [dot] example [dot] org</p>",
    "https://other.example.org/about": "<p>No address here.</p>",
}


def _page(url, **_kwargs):
    if url not in PAGES:
        raise httpx.ConnectError("offline")
    return SimpleNamespace(status_code=200, text=PAGES[url])


def test_leads_are_checked_and_unverifiable_known_or_past_ones_dropped(monkeypatch):
    prompts = []

    def run_agent(prompt, **kwargs):
        prompts.append((prompt, kwargs))
        return {
            "leads": [
                GOOD,
                {
                    **GOOD,
                    "event_name": "Gala",
                    "email": "events@club.example.org",
                    "source_url": "https://club.example.org/team",
                },
                {
                    **GOOD,
                    "email": "guessed@other.example.org",
                    "source_url": "https://other.example.org/about",
                },
                {**GOOD, "email": "known@examplehacks.ca"},
                {**GOOD, "email": "past@examplehacks.ca", "event_date": "2020-01-01"},
                {**GOOD, "email": "not-an-email"},
                {
                    **GOOD,
                    "email": "dead@examplehacks.ca",
                    "source_url": "https://gone.example.com/",
                },
                {**GOOD, "email": "hello@examplehacks.ca"},
            ]
        }

    monkeypatch.setattr(finder, "run_agent", run_agent)
    monkeypatch.setattr(finder.httpx, "get", _page)
    monkeypatch.setattr(
        finder, "CONTROL", finder.CONTROL.model_copy(update={"leads_per_search": 20})
    )

    leads = finder.find(CAMPAIGN, SCHOOL, ["known@examplehacks.ca"])

    assert [lead.email for lead in leads] == ["hello@examplehacks.ca", "events@club.example.org"]
    prompt, kwargs = prompts[0]
    assert kwargs["tools"] == ("WebSearch", "WebFetch") == kwargs["allowed_tools"]
    assert "University of Waterloo" in prompt
    assert "https://uwaterloo.wat2do.io/events/submit" in prompt
    assert "known@examplehacks.ca" in prompt
    assert "{{" not in prompt


def test_sweep_searches_each_active_campaign_school_and_reports_failures(monkeypatch):
    other = {"id": 8, "slug": "utsg", "name": "University of Toronto St. George"}
    scoped = CAMPAIGN.model_copy(
        update={"id": "99999999-9999-4999-8999-999999999993", "school_slugs": ["utsg", "gone"]}
    )
    monkeypatch.setattr(finder, "remove_leftovers", lambda _prefix: None)
    monkeypatch.setattr(finder.service, "schools", lambda: [SCHOOL, other])
    monkeypatch.setattr(finder.service, "active_campaigns", lambda: [CAMPAIGN, scoped])
    monkeypatch.setattr(finder.service, "known_emails", lambda _campaign, _limit: [])
    saved = []
    monkeypatch.setattr(
        finder.service,
        "save_leads",
        lambda campaign_id, school_id, leads: (
            saved.append((campaign_id, school_id, len(leads))) or len(leads)
        ),
    )
    searched = []

    def find(campaign, school, _known):
        searched.append((str(campaign.id), school["slug"]))
        if school["slug"] == "utsg" and campaign is CAMPAIGN:
            raise ClaudeCodeError("timed out")
        return [object()]

    monkeypatch.setattr(finder, "find", find)

    result = finder.sweep()

    assert sorted(searched) == sorted(
        [
            (str(CAMPAIGN.id), "uwaterloo"),
            (str(CAMPAIGN.id), "utsg"),
            (str(scoped.id), "utsg"),
        ]
    )
    assert result == {"saved": 2, "failed": [f"{CAMPAIGN.id}/utsg"]}
    assert sorted(saved) == sorted([(str(CAMPAIGN.id), 7, 1), (str(scoped.id), 8, 1)])
