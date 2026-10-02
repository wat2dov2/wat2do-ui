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


@pytest.mark.parametrize("failed", [0, 1])
def test_refresh_command_exposes_counts_only(monkeypatch, capsys, failed):
    monkeypatch.setattr(sys, "argv", ["job", "refresh-tokens"])
    monkeypatch.setattr(job, "refresh_expiring_tokens", lambda: {"failed": failed})
    assert job.main() == failed
    assert json.loads(capsys.readouterr().out) == {"failed": failed}


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
