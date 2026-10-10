"""Push new notification ledger rows to the browser worker as they are inserted.

Supabase Realtime streams each insert into the ledger table to this Mac, so a
notified post is opened as soon as it is recorded instead of on a timer.
Realtime only delivers while connected, so every (re)subscription also asks
the worker to catch up on rows recorded while it was away.
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
CONTROL = controlbox.instagram_browser


def listen_for_inserts(
    table: str, on_insert: Callable[[], None], stopping: threading.Event
) -> None:
    """Call ``on_insert`` for each inserted row and after every (re)subscription."""
    while not stopping.is_set():
        try:
            asyncio.run(_listen(table, on_insert, stopping))
        except Exception as exc:
            log.warning("Ledger listener disconnected (%s)", type(exc).__name__)
        stopping.wait(CONTROL.realtime_reconnect_seconds)


async def _listen(table: str, on_insert: Callable[[], None], stopping: threading.Event) -> None:
    client = AsyncRealtimeClient(
        f"{settings.supabase_url.replace('https://', 'wss://', 1).rstrip('/')}/realtime/v1",
        settings.supabase_secret_key,
        auto_reconnect=False,
    )
    await client.connect()
    lost = asyncio.Event()

    def on_state(state: RealtimeSubscribeStates, _error: Exception | None) -> None:
        if state == RealtimeSubscribeStates.SUBSCRIBED:
            on_insert()
        else:
            lost.set()

    try:
        channel = client.channel(f"wat2do-{table}")
        channel.on_postgres_changes(
            "INSERT", schema="public", table=table, callback=lambda _payload: on_insert()
        )
        await channel.subscribe(on_state)
        # Checking the open socket locally; no request leaves this Mac.
        while not stopping.is_set() and not lost.is_set() and client.is_connected:
            await asyncio.sleep(1)
    finally:
        await client.close()
