import pytest

from services.instagram_notifications import browser_queue


@pytest.fixture(autouse=True)
def unpaced_retrievals(monkeypatch):
    """Claim retrievals back to back unless a test exercises pacing itself."""
    monkeypatch.setattr(
        browser_queue,
        "CONTROL",
        browser_queue.CONTROL.model_copy(update={"retrieval_interval_seconds": 0}),
    )
