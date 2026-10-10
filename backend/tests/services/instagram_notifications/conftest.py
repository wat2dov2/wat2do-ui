import pytest

from services.instagram_notifications import browser_queue, ledger_listener


@pytest.fixture(autouse=True)
def unpaced_retrievals(monkeypatch):
    """Claim retrievals back to back unless a test exercises pacing itself."""
    monkeypatch.setattr(
        browser_queue,
        "CONTROL",
        browser_queue.CONTROL.model_copy(update={"retrieval_interval_seconds": 0}),
    )


@pytest.fixture(autouse=True)
def offline_ledger_listener(monkeypatch):
    """Never open a Realtime connection to Supabase from tests."""
    monkeypatch.setattr(
        ledger_listener, "listen_for_inserts", lambda _table, _on_insert, stopping: stopping.wait()
    )
