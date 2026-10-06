from unittest.mock import MagicMock

from services import automate_log_service as module


def test_logs_filter_sender_before_execution(monkeypatch):
    client = MagicMock()
    query = client.table.return_value
    query.select.return_value = query
    query.order.return_value = query
    query.limit.return_value = query
    query.eq.return_value = query
    query.execute.return_value.data = [{"event": "Browser worker: queued"}]
    monkeypatch.setattr(module, "get_sb", lambda: client)
    assert (
        module.get_automate_logs(sender_id="instagram-browser-worker")
        == query.execute.return_value.data
    )
    query.eq.assert_called_once_with("sender_id", "instagram-browser-worker")


def test_log_upload_failure_is_retryable_without_exposing_exception(monkeypatch, caplog):
    def unavailable():
        raise RuntimeError("sensitive-library-error")

    monkeypatch.setattr(module, "get_sb", unavailable)
    assert not module.create_automate_log("queued", None, None, None, None, None)
    assert "sensitive-library-error" not in caplog.text
