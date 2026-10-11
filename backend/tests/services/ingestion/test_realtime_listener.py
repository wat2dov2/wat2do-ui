import threading

import pytest
from realtime import RealtimeSubscribeStates

from services.ingestion import realtime_listener as module


@pytest.fixture(autouse=True)
def offline_listener(monkeypatch):
    """These tests exercise the real listener against a fake Realtime client."""
    monkeypatch.setattr(
        module,
        "CONTROL",
        module.CONTROL.model_copy(
            update={"realtime_reconnect_seconds": 0.01, "realtime_probe_seconds": 0.05}
        ),
    )
    monkeypatch.setattr(module, "_TICK_SECONDS", 0.01)
    monkeypatch.setattr(module.settings, "supabase_url", "https://ref.supabase.co")
    monkeypatch.setattr(module.settings, "supabase_secret_key", "service-key")


def test_listener_catches_up_on_every_subscription_and_wakes_on_each_change(monkeypatch):
    stopping = threading.Event()
    connections = []
    closed = []
    listened = []

    class Channel:
        callbacks: list = []

        def on_postgres_changes(self, event, *, schema, table, callback):
            listened.append((event, schema, table))
            self.callbacks = [*self.callbacks, callback]
            return self

        def on_broadcast(self, event, callback):
            return self

        async def subscribe(self, on_state):
            on_state(RealtimeSubscribeStates.SUBSCRIBED, None)
            for callback in self.callbacks:
                callback({"record": {"source_url": "https://example.com/"}})
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

        def channel(self, topic, params):
            assert params == {"config": {"broadcast": {"self": True}}}
            return Channel()

        async def close(self):
            closed.append(True)

    monkeypatch.setattr(module, "AsyncRealtimeClient", Client)
    wakes = []

    module.listen_for_changes("ingestion_items", lambda: wakes.append(1), stopping)

    assert connections == [("wss://ref.supabase.co/realtime/v1", "service-key", False)] * 2
    assert (
        listened
        == [
            ("INSERT", "public", "ingestion_items"),
            ("UPDATE", "public", "ingestion_items"),
        ]
        * 2
    )
    # Each connection: one catch-up on subscribing plus one wake per change.
    assert len(wakes) == 6
    assert len(closed) == 2


def test_listener_keeps_reconnecting_after_failures(monkeypatch):
    stopping = threading.Event()
    attempts = []

    async def failing(table, on_change, stop):
        attempts.append(table)
        if len(attempts) == 3:
            stopping.set()
        raise OSError("network down")

    monkeypatch.setattr(module, "_listen", failing)

    module.listen_for_changes("ingestion_items", lambda: None, stopping)

    assert attempts == ["ingestion_items"] * 3


def test_listener_reconnects_when_its_probe_stops_echoing(monkeypatch):
    stopping = threading.Event()
    connections = []
    probes = []

    class Channel:
        def __init__(self):
            self.echo = None

        def on_postgres_changes(self, event, *, schema, table, callback):
            return self

        def on_broadcast(self, event, callback):
            assert event == "probe"
            self.echo = callback
            return self

        async def subscribe(self, on_state):
            on_state(RealtimeSubscribeStates.SUBSCRIBED, None)
            return self

        async def send_broadcast(self, event, data):
            probes.append(len(connections))
            # The first connection has gone deaf; the second echoes until stopped.
            if len(connections) == 2:
                self.echo({"event": event})
                if probes.count(2) == 3:
                    stopping.set()

    class Client:
        def __init__(self, url, token, auto_reconnect):
            connections.append(url)

        async def connect(self):
            pass

        def channel(self, topic, params):
            return Channel()

        async def close(self):
            pass

    monkeypatch.setattr(module, "AsyncRealtimeClient", Client)
    wakes = []

    module.listen_for_changes("ingestion_items", lambda: wakes.append(1), stopping)

    # One unanswered probe ends the deaf connection; the replacement catches up.
    assert len(connections) == 2
    assert probes.count(1) == 1
    assert probes.count(2) == 3
    assert len(wakes) == 2
