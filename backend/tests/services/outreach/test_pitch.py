import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from pydantic import ValidationError

from schemas.outreach import Pitch
from services.claude_code import ClaudeCodeError
from services.outreach import pitch

LEAD = {
    "lead_id": "lead-1",
    "club_name": "Running Club",
    "school_name": "University of Waterloo",
    "ig": "uwrunning",
    "club_page": None,
    "categories": ["Sports"],
    "events": [{"title": "Bonfire Social", "starts": "2026-10-30T23:00:00+00:00"}],
}
SCRIPT = "Hey Running Club! " + "Your bonfire socials are exactly what campus needs. " * 8
BODY = "Hi Running Club team,\n\nI made you a video.\n\n{{claim_url}}\n\nTony"


def _fit(**changes):
    return {
        "fit": True,
        "reason": "Bonfire socials and an ice cream run students drop into.",
        "script": SCRIPT,
        "email_subject": "Running Club, your bonfires deserve a crowd",
        "email_body": BODY,
        **changes,
    }


def test_a_fit_keeps_its_script_and_email_with_one_claim_link():
    written = Pitch.model_validate(_fit())
    assert written.fit and written.email_body.count("{{claim_url}}") == 1


def test_a_club_that_is_not_a_fit_keeps_only_its_reason():
    written = Pitch.model_validate(
        {
            "fit": False,
            "reason": "Only weekly practices.",
            "script": "x",
            "email_subject": "y",
            "email_body": "z",
        }
    )
    assert (written.script, written.email_subject, written.email_body) == ("", "", "")


@pytest.mark.parametrize(
    "changes",
    [
        {"email_body": BODY.replace("{{claim_url}}", "")},
        {"email_body": BODY + "\n{{claim_url}}"},
        {"email_body": BODY.replace("{{claim_url}}", "https://wat2do.io/claim/x")},
        {"email_body": BODY + "\nSee https://uwrunning.ca"},
        {"script": SCRIPT + " Visit www.example.com"},
        {"script": SCRIPT.replace("!", " —")},
        {"email_subject": "Hi {{club_name}}"},
        {"script": "Too short."},
        {"email_subject": ""},
        {"reason": ""},
    ],
)
def test_a_pitch_that_breaks_the_rules_is_refused(changes):
    with pytest.raises(ValidationError):
        Pitch.model_validate(_fit(**changes))


def test_the_prompt_names_the_school_offer_and_sender_but_leaves_the_claim_link():
    prompt = pitch._prompt(LEAD)
    assert "University of Waterloo" in prompt
    assert f"${pitch.CONTROL.qr_reimbursement_dollars}" in prompt
    assert pitch.CONTROL.sender_name in prompt
    assert "{{claim_url}}" in prompt
    assert "{{" not in prompt.replace("{{claim_url}}", "")
    assert "—" not in prompt


def test_claude_reads_the_club_from_a_file_with_read_only_tools(monkeypatch):
    seen = {}

    def run_agent(prompt, *, workdir, model, tools, allowed_tools, schema, timeout):
        seen["club"] = json.loads((Path(workdir) / "club.json").read_text())
        seen["tools"] = (tools, allowed_tools, model)
        return _fit()

    monkeypatch.setattr(pitch, "run_agent", run_agent)
    written = pitch.pitch(LEAD)
    assert written is not None and written.fit
    assert seen["club"]["events"] == LEAD["events"] and seen["club"]["name"] == "Running Club"
    assert seen["tools"] == (("Read",), ("Read(./**)",), pitch.CONTROL.pitch_model)


def test_pitches_are_saved_and_failures_wait_for_the_next_run(monkeypatch):
    leads = [{**LEAD, "lead_id": lead_id} for lead_id in ("fit", "unfit", "broken", "failed")]
    asked = {}

    def unpitched(schools, limit, *, recheck_before, event_limit):
        asked.update(
            schools=schools, limit=limit, recheck_before=recheck_before, events=event_limit
        )
        return leads

    answers = {
        "fit": Pitch.model_validate(_fit()),
        "unfit": Pitch.model_validate({"fit": False, "reason": "Only exec meetings."}),
        "broken": None,
    }

    def write(lead):
        if lead["lead_id"] == "failed":
            raise ClaudeCodeError("timed out")
        return answers[lead["lead_id"]]

    saved = []
    monkeypatch.setattr(pitch, "remove_leftovers", lambda _prefix: None)
    monkeypatch.setattr(pitch.service, "unpitched", unpitched)
    monkeypatch.setattr(pitch, "pitch", write)
    monkeypatch.setattr(pitch.service, "save_pitch", lambda lead_id, written: saved.append(lead_id))

    assert pitch.write_pitches() == {"pitch_fit": 1, "pitch_not_fit": 1, "pitch_failed": 2}
    assert saved == ["fit", "unfit"]
    assert asked["schools"] == ["uwaterloo"] and asked["limit"] == pitch.CONTROL.pitches_per_sweep
    expected = datetime.now(UTC) - timedelta(days=pitch.CONTROL.pitch_recheck_days)
    assert abs((asked["recheck_before"] - expected).total_seconds()) < 60
