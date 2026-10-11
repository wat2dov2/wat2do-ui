"""Wake the ingestion processor whenever its Supabase queue changes.

Supabase Realtime streams every insert and update on the queue table to this
Mac, so a notified post is fetched, and a ready row processed, as soon as it
appears instead of on a timer. Realtime only delivers while connected, so
every (re)subscription also wakes the processor to catch up on what changed
while it was away, and a periodic self-echo reconnects a connection that has
silently stopped delivering.
"""

from __future__ import annotations

import asyncio
import logging
import threading
import time
from collections.abc import Callable

from realtime import AsyncRealtimeClient, RealtimeSubscribeStates

from core.config import settings
from core.controlbox import controlbox

log = logging.getLogger(__name__)
CONTROL = controlbox.ingestion
_PROBE_EVENT = "probe"
_TICK_SECONDS = 1.0


def listen_for_changes(
    table: str, on_change: Callable[[], None], stopping: threading.Event
) -> None:
    """Call ``on_change`` for each inserted or updated row and after every (re)subscription."""
    while not stopping.is_set():
        try:
            asyncio.run(_listen(table, on_change, stopping))
        except Exception as exc:
            log.warning("Ingestion queue listener disconnected (%s)", type(exc).__name__)
        stopping.wait(CONTROL.realtime_reconnect_seconds)


async def _listen(table: str, on_change: Callable[[], None], stopping: threading.Event) -> None:
    client = AsyncRealtimeClient(
        f"{settings.supabase_url.replace('https://', 'wss://', 1).rstrip('/')}/realtime/v1",
        settings.supabase_secret_key,
        auto_reconnect=False,
    )
    await client.connect()
    lost = asyncio.Event()
    echoed: list[float] = []

    def on_state(state: RealtimeSubscribeStates, _error: Exception | None) -> None:
        if state == RealtimeSubscribeStates.SUBSCRIBED:
            on_change()
        else:
            lost.set()

    try:
        # The channel hears its own broadcasts, so an echo proves the socket and
        # channel still deliver. The client's is_connected stays true after the
        # socket closes, so it cannot tell a dead connection from a quiet one.
        channel = client.channel(
            f"wat2do-{table}", {"config": {"broadcast": {"self": True}}}
        )
        channel.on_broadcast(_PROBE_EVENT, lambda _payload: echoed.append(time.monotonic()))
        for event in ("INSERT", "UPDATE"):
            channel.on_postgres_changes(
                event, schema="public", table=table, callback=lambda _payload: on_change()
            )
        await channel.subscribe(on_state)
        probed: float | None = None
        due = time.monotonic() + CONTROL.realtime_probe_seconds
        while not stopping.is_set() and not lost.is_set():
            if time.monotonic() >= due:
                # Each probe must echo before the next is due.
                if probed is not None and (not echoed or echoed[-1] < probed):
                    raise ConnectionError("Realtime stopped echoing its probe")
                probed = time.monotonic()
                due = probed + CONTROL.realtime_probe_seconds
                await channel.send_broadcast(_PROBE_EVENT, {})
            await asyncio.sleep(_TICK_SECONDS)
    finally:
        try:
            await asyncio.wait_for(client.close(), CONTROL.realtime_reconnect_seconds)
        except Exception:
            pass  # A dead socket may not close cleanly; the next connection replaces it.
