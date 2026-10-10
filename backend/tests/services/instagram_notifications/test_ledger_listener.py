import threading

import pytest
from realtime import RealtimeSubscribeStates

from services.instagram_notifications import ledger_listener as module


@pytest.fixture(autouse=True)
def offline_ledger_listener(monkeypatch):
    """These tests exercise the real listener against a fake Realtime client."""
    monkeypatch.setattr(
        module, "CONTROL", module.CONTROL.model_copy(update={"realtime_reconnect_seconds": 0.01})
    )
    monkeypatch.setattr(module.settings, "supabase_url", "https://ref.supabase.co")
    monkeypatch.setattr(module.settings, "supabase_secret_key", "service-key")


def test_listener_catches_up_on_every_subscription_and_wakes_on_each_insert(monkeypatch):
    stopping = threading.Event()
    connections = []
    closed = []
    listened = []

    class Channel:
        def on_postgres_changes(self, event, *, schema, table, callback):
            listened.append((event, schema, table))
            self.insert = callback
            return self

        async def subscribe(self, on_state):
            on_state(RealtimeSubscribeStates.SUBSCRIBED, None)
            self.insert({"record": {"id": 1}})
            if len(connections) == 1:
                # The first connection drops; the listener reconnects and catches up.
                on_state(RealtimeSubscribeStates.CHANNEL_ERROR, None)
            else:
                stopping.set()
            return self

    class Client:
        def __init__(self, url, token, auto_reconnect):
            connections.append((url, token, auto_reconnect))
            self.is_connected = True

        async def connect(self):
            pass

        def channel(self, topic):
            return Channel()

        async def close(self):
            closed.append(True)

    monkeypatch.setattr(module, "AsyncRealtimeClient", Client)
    wakes = []

    module.listen_for_inserts("instagram_notification_media", lambda: wakes.append(1), stopping)

    assert connections == [("wss://ref.supabase.co/realtime/v1", "service-key", False)] * 2
    assert listened == [("INSERT", "public", "instagram_notification_media")] * 2
    # Each connection: one catch-up on subscribing plus one wake for the insert.
    assert len(wakes) == 4
    assert len(closed) == 2


def test_listener_keeps_reconnecting_after_failures(monkeypatch):
    stopping = threading.Event()
    attempts = []

    async def failing(table, on_insert, stop):
        attempts.append(table)
        if len(attempts) == 3:
            stopping.set()
        raise OSError("network down")

    monkeypatch.setattr(module, "_listen", failing)

    module.listen_for_inserts("instagram_notification_media", lambda: None, stopping)

    assert attempts == ["instagram_notification_media"] * 3
