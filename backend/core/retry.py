"""Bounded recovery for Supabase table reads at the HTTP transport boundary.

Only GET/HEAD table requests are replayable here. Writes, RPCs, auth, and HTTP
error responses are returned once to their caller. Retrying one failed page
preserves successful work and avoids rerunning whole multi-query services.
"""

from collections.abc import Callable
from time import sleep

import httpx
from tenacity import Retrying, retry_if_exception_type, stop_after_attempt, wait_exponential_jitter

from core.controlbox import controlbox
from core.logging import logger


class SupabaseReadTransport(httpx.BaseTransport):
    def __init__(
        self,
        transport: httpx.BaseTransport | None = None,
        *,
        wait: Callable[[float], None] = sleep,
    ) -> None:
        # HTTP/2 connection termination has disrupted unrelated in-flight
        # requests sharing a session. HTTP/1.1 keeps the existing pooled client
        # while avoiding that shared multiplexed connection failure mode.
        self._transport = transport or httpx.HTTPTransport(http2=False, retries=0)
        self._wait = wait

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        is_table_read = (
            request.method in {"GET", "HEAD"}
            and request.url.path.startswith("/rest/v1/")
            and not request.url.path.startswith("/rest/v1/rpc/")
        )
        if not is_table_read:
            return self._transport.handle_request(request)

        config = controlbox.database
        retrying = Retrying(
            retry=retry_if_exception_type(
                (httpx.NetworkError, httpx.TimeoutException, httpx.RemoteProtocolError)
            ),
            stop=stop_after_attempt(config.read_attempts),
            wait=wait_exponential_jitter(
                initial=config.read_backoff_initial_seconds,
                max=config.read_backoff_max_seconds,
                jitter=config.read_backoff_jitter_seconds,
            ),
            sleep=self._wait,
            reraise=True,
        )
        for attempt in retrying:
            with attempt:
                if attempt.retry_state.attempt_number > 1:
                    logger.warning(
                        "Retrying Supabase table read method=%s path=%s attempt=%s",
                        request.method,
                        request.url.path,
                        attempt.retry_state.attempt_number,
                    )
                response = self._transport.handle_request(request)
                try:
                    # A disconnect can occur after headers arrive. Read inside
                    # the retry boundary so a partial body is never published.
                    response.read()
                finally:
                    response.close()
                return response
        raise RuntimeError("Supabase read retry exhausted without a result")

    def close(self) -> None:
        self._transport.close()
