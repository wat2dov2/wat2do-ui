import pytest

from services.instagram_publishing import curation
from services.instagram_publishing.curation import _validate_scores


def _candidates():
    return [
        {"id": 10, "source_image_url": "https://example.com/10.jpg"},
        {"id": 11, "source_image_url": "https://example.com/11.jpg"},
    ]


def test_validate_scores_recomputes_weighted_overall_score():
    result = _validate_scores(
        {
            "events": [
                {
                    "event_id": 10,
                    "visual_score": 10,
                    "excitement_score": 8,
                    "audience_score": 6,
                    "timing_score": 4,
                },
                {
                    "event_id": 11,
                    "visual_score": 5,
                    "excitement_score": 5,
                    "audience_score": 5,
                    "timing_score": 5,
                },
            ]
        },
        _candidates(),
    )

    assert result == [
        {"event_id": 10, "overall_score": 8.0},
        {"event_id": 11, "overall_score": 5.0},
    ]


def test_validate_scores_rejects_missing_candidate():
    with pytest.raises(ValueError, match="every candidate"):
        _validate_scores(
            {
                "events": [
                    {
                        "event_id": 10,
                        "visual_score": 8,
                        "excitement_score": 8,
                        "audience_score": 8,
                        "timing_score": 8,
                    }
                ]
            },
            _candidates(),
        )


def test_rank_candidates_uses_responses_structured_output_and_high_detail(monkeypatch):
    calls = []

    class FakeResponses:
        def parse(self, **kwargs):
            calls.append(kwargs)
            return type(
                "Response",
                (),
                {
                    "output_parsed": curation._CurationResponse(
                        events=[
                            curation._CurationScore(
                                event_id=candidate["id"],
                                visual_score=8,
                                excitement_score=7,
                                audience_score=6,
                                timing_score=5,
                            )
                            for candidate in _candidates()
                        ]
                    )
                },
            )()

    class FakeOpenAI:
        def __init__(self, **_kwargs):
            self.responses = FakeResponses()

    monkeypatch.setattr(curation, "OpenAI", FakeOpenAI)
    monkeypatch.setattr(curation.settings, "openai_api_key", "test-key")

    result = curation.rank_candidates(_candidates())

    assert [row["event_id"] for row in result] == [10, 11]
    assert calls[0]["text_format"] is curation._CurationResponse
    assert calls[0]["store"] is False
    assert calls[0]["reasoning"] == {"effort": "low"}
    images = [part for part in calls[0]["input"][0]["content"] if part["type"] == "input_image"]
    assert len(images) == 2
    assert all(image["detail"] == "high" for image in images)
