"""Supabase only — no SQLAlchemy. Use this client for all table access."""

from supabase import create_client, Client

from core.config import settings

# --- Fail-fast: service-role key is required for backend operation ----------
# Every table has RLS enabled with no permissive policies.  Without the
# service-role key the backend would silently use the anon client, which
# is blocked by RLS on every query — returning empty results or 403s.
if not settings.supabase_secret_key:
    raise RuntimeError(
        "SUPABASE_SECRET_KEY is not set. The backend requires the service-role "
        "key to bypass RLS. Set it in your .env file "
        "(Dashboard > Settings > API Keys)."
    )

supabase: Client = create_client(settings.supabase_url, settings.supabase_key)

# Service-role client for backend table access (bypasses RLS).
supabase_admin: Client = create_client(
    settings.supabase_url, settings.supabase_secret_key
)


def get_sb() -> Client:
    """Return the service-role client (bypasses RLS)."""
    return supabase_admin
