"""Safe table-read retries, including disconnects after response headers."""

from unittest.mock import MagicMock

import httpx
import pytest
from postgrest import SyncPostgrestClient

from core.controlbox import controlbox
from core.retry import SupabaseReadTransport


@pytest.mark.parametrize("method", ["GET", "HEAD"])
@pytest.mark.parametrize(
    "error", [httpx.ConnectError, httpx.ReadError, httpx.RemoteProtocolError, httpx.ReadTimeout]
)
def test_table_read_recovers_once_without_replaying_a_service(method, error):
    send = MagicMock(
        side_effect=[error("connection terminated"), httpx.Response(200, json=[{"id": 7}])]
    )
    wait = MagicMock()
    with httpx.Client(
        transport=SupabaseReadTransport(httpx.MockTransport(send), wait=wait)
    ) as client:
        response = client.request(method, "https://example.supabase.co/rest/v1/events")
    assert response.json() == [{"id": 7}]
    assert send.call_count == 2
    wait.assert_called_once()


def test_read_recovers_after_headers_and_discards_partial_body():
    closed = MagicMock()

    class InterruptedBody(httpx.SyncByteStream):
        def __iter__(self):
            yield b'[{"id":'
            raise httpx.ReadError("connection closed during body")

        def close(self):
            closed()

    send = MagicMock(
        side_effect=[
            httpx.Response(200, stream=InterruptedBody()),
            httpx.Response(200, json=[{"id": 42}]),
        ]
    )
    with httpx.Client(
        transport=SupabaseReadTransport(httpx.MockTransport(send), wait=lambda _: None)
    ) as client:
        response = client.get("https://example.supabase.co/rest/v1/events")
    assert response.json() == [{"id": 42}]
    assert send.call_count == 2
    closed.assert_called_once()


@pytest.mark.parametrize(
    "method,path",
    [
        ("POST", "/rest/v1/events"),
        ("PATCH", "/rest/v1/events"),
        ("DELETE", "/rest/v1/events"),
        ("POST", "/rest/v1/rpc/update_event_with_occurrences"),
        ("GET", "/rest/v1/rpc/some_function"),
        ("POST", "/auth/v1/token"),
        ("GET", "/auth/v1/user"),
    ],
)
def test_writes_rpcs_and_auth_are_never_retried(method, path):
    send = MagicMock(side_effect=httpx.RemoteProtocolError("disconnected"))
    wait = MagicMock()
    with httpx.Client(
        transport=SupabaseReadTransport(httpx.MockTransport(send), wait=wait)
    ) as client:
        with pytest.raises(httpx.RemoteProtocolError):
            client.request(method, f"https://example.supabase.co{path}")
    assert send.call_count == 1
    wait.assert_not_called()


def test_read_retry_budget_is_bounded_and_preserves_original_error():
    error = httpx.RemoteProtocolError("still disconnected")
    send = MagicMock(side_effect=error)
    with httpx.Client(
        transport=SupabaseReadTransport(httpx.MockTransport(send), wait=lambda _: None)
    ) as client:
        with pytest.raises(httpx.RemoteProtocolError) as raised:
            client.get("https://example.supabase.co/rest/v1/events")
    assert raised.value is error
    assert send.call_count == controlbox.database.read_attempts


@pytest.mark.parametrize("status", [400, 401, 403, 429, 500, 503])
def test_http_responses_are_not_retried(status):
    send = MagicMock(return_value=httpx.Response(status, json={"message": "upstream failure"}))
    with httpx.Client(transport=SupabaseReadTransport(httpx.MockTransport(send))) as client:
        response = client.get("https://example.supabase.co/rest/v1/events")
    assert response.status_code == status
    assert send.call_count == 1


def test_postgrest_query_uses_transport_recovery_with_request_filters_preserved():
    send = MagicMock(
        side_effect=[
            httpx.RemoteProtocolError("disconnected"),
            httpx.Response(200, json=[{"id": 7}]),
        ]
    )
    with httpx.Client(
        transport=SupabaseReadTransport(httpx.MockTransport(send), wait=lambda _: None)
    ) as http_client:
        client = SyncPostgrestClient("https://example.supabase.co/rest/v1", http_client=http_client)
        response = client.table("events").select("id").eq("school_id", 3).execute()
    assert response.data == [{"id": 7}]
    first, second = [call.args[0] for call in send.call_args_list]
    assert str(first.url) == str(second.url)
    assert first.url.params["school_id"] == "eq.3"


def test_default_transport_explicitly_disables_http2_and_connect_retries(monkeypatch):
    factory = MagicMock()
    monkeypatch.setattr(httpx, "HTTPTransport", factory)
    transport = SupabaseReadTransport()
    factory.assert_called_once_with(http2=False, retries=0)
    transport.close()
    factory.return_value.close.assert_called_once()
