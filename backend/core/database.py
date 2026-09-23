"""Supabase only - no SQLAlchemy. Use this client for all table access.

Export contract:
  * :func:`get_sb` returns the service-role client for backend DB access
    (bypasses RLS).  **Use this for every table read/write.**
  * :data:`supabase_admin` is the same client, exposed for call sites that
    need to construct queries lazily inside a service class.
  * :data:`supabase` is the *anon* client used ONLY for Supabase Auth
    calls (``auth.sign_up``, ``auth.sign_in_with_password``, …).  It is
    RLS-bound and must **not** be used for PostgREST table access; doing
    so will silently return empty results (or 403) in production.

Direct ``from core.database import supabase`` imports are discouraged -
every table path should go through ``get_sb()``.  The lone legitimate
consumer is ``services/auth_service.py``, which imports ``supabase``
lazily so a typo elsewhere fails fast at call time rather than silently
swapping clients.
"""

from core.config import settings
from supabase import Client, ClientOptions, create_client

# --- Fail-fast: service-role key is required for backend operation ----------
# Every table has RLS enabled with no permissive policies.  Without the
# service-role key the backend would silently use the anon client, which
# is blocked by RLS on every query - returning empty results or 403s.
if not settings.supabase_secret_key:
    raise RuntimeError(
        "SUPABASE_SECRET_KEY is not set. The backend requires the service-role "
        "key to bypass RLS. Set it in your .env file "
        "(Dashboard > Settings > API Keys)."
    )

# Anon client: RLS-bound, for Supabase Auth endpoints only.  Kept at module
# scope for the one caller that needs it (auth_service), but not re-exported
# via ``__all__`` to discourage accidental adoption elsewhere.  New code
# should not import this - use ``get_sb()``.
# Only browser-initiated auth requests may rotate tokens, because their HTTP
# responses deliver the replacement refresh cookie. Background SDK refreshes
# leave the browser holding an older token and make sessions worker-dependent.
supabase: Client = create_client(
    settings.supabase_url,
    settings.supabase_key,
    ClientOptions(auto_refresh_token=False, persist_session=False),
)

# Service-role client for backend table access (bypasses RLS).
supabase_admin: Client = create_client(settings.supabase_url, settings.supabase_secret_key)


def get_sb() -> Client:
    """Return the service-role client (bypasses RLS)."""
    return supabase_admin


__all__ = ("get_sb", "supabase_admin")
