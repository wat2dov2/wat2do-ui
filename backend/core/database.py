"""The one client for table access: PostgREST in front of Postgres.

:func:`get_sb` returns the client every service uses for reads, writes and
RPCs.  Each request carries the service JWT from ``DATA_API_KEY``, which maps
to a role that bypasses RLS, so the backend sees every row.  Sessions and
login live in our own auth service (``services/auth_service.py``), not here.
"""

import httpx
from postgrest import SyncPostgrestClient

from core.config import settings
from core.retry import DataApiReadTransport

# --- Fail-fast: the service key is required for backend operation ----------
# Every table has RLS enabled with no permissive policies.  Without the
# service key the data API rejects every request.
if not settings.data_api_key:
    raise RuntimeError(
        "DATA_API_KEY is not set. The backend needs the data API service key "
        "for every table read and write. Set it in your .env file."
    )

_TIMEOUT_SECONDS = 120

data_api = SyncPostgrestClient(
    settings.data_api_url.rstrip("/"),
    headers={
        "Accept": "application/json",
        "Content-Type": "application/json",
        # PostgREST reads the bearer JWT. ``apikey`` is what a gateway in front
        # of PostgREST may also expect; PostgREST itself ignores it.
        "apikey": settings.data_api_key,
        "Authorization": f"Bearer {settings.data_api_key}",
    },
    http_client=httpx.Client(
        base_url=settings.data_api_url.rstrip("/"),
        transport=DataApiReadTransport(),
        timeout=_TIMEOUT_SECONDS,
        follow_redirects=True,
    ),
)


def get_sb() -> SyncPostgrestClient:
    """Return the data API client (service role, bypasses RLS)."""
    return data_api


__all__ = ("data_api", "get_sb")
