import json
import sys
from unittest.mock import Mock

import pytest

from jobs import generate_instagram_posts as job


def test_candidate_command_reads_without_saving(monkeypatch, capsys):
    monkeypatch.setattr(sys, "argv", ["job", "candidates"])
    monkeypatch.setattr(job, "list_draft_candidates", lambda: [{"account_key": "uwaterloo"}])
    save = Mock()
    monkeypatch.setattr(job, "save_review_draft", save)
    assert job.main() == 0
    assert json.loads(capsys.readouterr().out) == [{"account_key": "uwaterloo"}]
    save.assert_not_called()


def test_save_command_validates_external_choices(monkeypatch, tmp_path, capsys):
    path = tmp_path / "selection.json"
    path.write_text(
        json.dumps(
            {
                "account_key": "uwaterloo",
                "window_end": "2026-09-28T14:00:00Z",
                "caption_intro": "Today's plans",
                "cover_body": "Campus picks",
                "picks": [{"event_id": 17, "sticker_labels": ["Meet Friends"]}],
            }
        )
    )
    monkeypatch.setattr(sys, "argv", ["job", "save", str(path)])
    saved = Mock(return_value={"outcome": "saved", "batch": {"id": "draft-1"}})
    monkeypatch.setattr(job, "save_review_draft", saved)
    assert job.main() == 0
    assert saved.call_args.args[0].picks[0].event_id == 17
    assert json.loads(capsys.readouterr().out)["batch"]["id"] == "draft-1"


@pytest.mark.parametrize(("outcomes", "code"), [({"saved": 2}, 0), ({"saved": 1, "failed": 1}, 1)])
def test_curate_command_reports_outcomes(monkeypatch, capsys, outcomes, code):
    from services.instagram_publishing import curation

    monkeypatch.setattr(sys, "argv", ["job", "curate"])
    monkeypatch.setattr(curation, "curate_all", lambda: outcomes)
    assert job.main() == code
    assert json.loads(capsys.readouterr().out) == outcomes


def test_publish_batch_command_posts_the_claimed_batch(monkeypatch, capsys):
    # The API's Publish button starts this after it claims the batch.
    monkeypatch.setattr(sys, "argv", ["job", "publish-batch", "batch-1"])
    publish = Mock(return_value="failed")
    monkeypatch.setattr(job, "publish_batch", publish)
    assert job.main() == 0
    publish.assert_called_once_with("batch-1")
    assert json.loads(capsys.readouterr().out) == {"status": "failed"}


def test_launch_agent_runs_curate_daily_without_logs():
    payload = job.launch_agent_payload()
    assert payload["ProgramArguments"][-1] == "curate"
    assert payload["StartCalendarInterval"] == [
        {"Hour": hour, "Minute": 0} for hour in (9, 11, 13, 15)
    ]
    assert payload["StandardOutPath"] == "/dev/null"


@pytest.mark.parametrize(
    ("outcomes", "code"), [({"published": 3}, 0), ({"published": 1, "failed": 1}, 1)]
)
def test_publish_command_reports_outcomes(monkeypatch, tmp_path, capsys, outcomes, code):
    monkeypatch.setattr(sys, "argv", ["job", "publish"])
    monkeypatch.setattr(job, "LOCK_PATH", tmp_path / "lock")
    monkeypatch.setattr(job, "publish_ready_drafts", lambda: outcomes)
    assert job.main() == code
    assert json.loads(capsys.readouterr().out) == outcomes


def test_publish_launch_agent_runs_at_nine_thirty_five():
    payload = job.publish_launch_agent_payload()
    assert payload["Label"] == "io.wat2do.instagram.publish"
    assert payload["ProgramArguments"][-1] == "publish"
    assert payload["StartCalendarInterval"] == [{"Hour": 9, "Minute": 35}]
