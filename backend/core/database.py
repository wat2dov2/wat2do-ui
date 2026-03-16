"""Supabase only — no SQLAlchemy. Use this client for all table access."""

from supabase import create_client, Client

from core.config import settings

supabase: Client = create_client(settings.supabase_url, settings.supabase_key)

# Service role client for backend table access (bypasses RLS). Use when set.
supabase_admin: Client | None = (
    create_client(settings.supabase_url, settings.supabase_secret_key)
    if settings.supabase_secret_key
    else None
)


def get_sb() -> Client:
    """Use admin client when available so backend has full table access."""
    return supabase_admin if supabase_admin else supabase
