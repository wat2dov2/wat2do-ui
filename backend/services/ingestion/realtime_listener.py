"""Wake the ingestion processor whenever its Supabase queue changes.

Supabase Realtime streams every insert and update on the queue table to this
Mac, so a notified post is fetched, and a ready row processed, as soon as it
appears instead of on a timer. Realtime only delivers while connected, so
every (re)subscription also wakes the processor to catch up on what changed
while it was away.
"""

from __future__ import annotations

import asyncio
import logging
import threading
from collections.abc import Callable

from realtime import AsyncRealtimeClient, RealtimeSubscribeStates

from core.config import settings
from core.controlbox import controlbox

log = logging.getLogger(__name__)
CONTROL = controlbox.ingestion


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

    def on_state(state: RealtimeSubscribeStates, _error: Exception | None) -> None:
        if state == RealtimeSubscribeStates.SUBSCRIBED:
            on_change()
        else:
            lost.set()

    try:
        channel = client.channel(f"wat2do-{table}")
        for event in ("INSERT", "UPDATE"):
            channel.on_postgres_changes(
                event, schema="public", table=table, callback=lambda _payload: on_change()
            )
        await channel.subscribe(on_state)
        # Checking the open socket locally; no request leaves this Mac.
        while not stopping.is_set() and not lost.is_set() and client.is_connected:
            await asyncio.sleep(1)
    finally:
        await client.close()
