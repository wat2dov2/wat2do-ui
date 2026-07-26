from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Default origins allowed in local development only.
_DEV_ORIGINS = [
    "http://localhost:3000",
]


class Settings(BaseSettings):
    # `extra="ignore"` - .env holds some shell-only vars (e.g. DATABASE_URL,
    # read by the Supabase CLI) that the Python runtime doesn't need as
    # typed fields. Ignoring them keeps Settings focused on what the app
    # actually reads.
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # "development", "testing", or "production". Controls OpenAPI docs visibility.
    environment: str = "development"

    supabase_url: str
    supabase_key: str
    supabase_secret_key: str = ""
    database_url: str = ""
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"
    openai_timeout: int = 15
    openai_temperature_precise: float = 0.3
    openai_temperature_creative: float = 0.7
    openai_instagram_curation_model: str = "gpt-5.6-sol"
    openai_instagram_curation_timeout: int = 60
    # Apify token for the Instagram scraper (services/scraper).
    # Empty string => the scraping pipeline raises at startup.  Set in
    # GitHub repo secrets for the process-single-user workflow.
    apify_api_token: str = ""
    # OpenAI model used for vision-based event extraction in services/scraper.
    # Kept separate from ``openai_model`` so we can swap the extraction model
    # (vision-capable) without affecting non-vision call sites.
    openai_extraction_model: str = "gpt-4o-mini"
    # Set CORS_ORIGINS env var as a JSON list for production,
    # e.g. CORS_ORIGINS=["https://wat2do.app","https://www.wat2do.app"]
    cors_origins: list[str] = _DEV_ORIGINS
    # Optional regex for trusted dynamic origins, e.g. school subdomains.
    cors_origin_regex: str = ""
    cookie_domain: str = ""
    # Secure cookies by default (HTTPS-only). Set COOKIE_SECURE=false for local HTTP dev.
    cookie_secure: bool = True
    # Browser-visible path for the refresh cookie. Keep local/dev at the API
    # route; set to /api/auth/refresh when the frontend proxies API calls.
    refresh_cookie_path: str = "/auth/refresh"
    # Trusted reverse-proxy IPs.  When a request arrives from one of these
    # addresses, ``get_client_ip()`` reads the real client IP from the
    # ``X-Forwarded-For`` / ``X-Real-IP`` headers instead of
    # ``request.client.host``.
    #
    # **Security warning:** The default is *loopback only*.  A broad
    # CIDR range (e.g. the whole Docker bridge ``172.16.0.0/12``) is a
    # spoofing vector: any co-tenant / side-car container with an IP in
    # that range can forge ``X-Forwarded-For`` and impersonate an
    # arbitrary client - bypassing every rate-limit keyed on IP.
    # Deployers **must** explicitly list the proxy's IP (ideally a ``/32``)
    # via the ``TRUSTED_PROXIES`` env var (JSON list); never add a range
    # that shares peers with untrusted workloads.
    trusted_proxies: list[str] = ["127.0.0.1", "::1"]

    # --- Email provider (notifications) ----------------------------------
    # Empty string => dry-run mode (log-only). Set to ``resend`` to send
    # via Resend, and populate ``email_provider_api_key`` + ``email_from``.
    email_provider: str = ""
    email_provider_api_key: str = ""
    email_from: str = "wat2do <notifications@wat2do.io>"
    frontend_url: str = "http://localhost:3000"
    email_unsubscribe_secret: str = ""
    event_feed_revalidation_url: str = ""
    event_feed_revalidation_secret: str = ""
    event_feed_revalidation_timeout: float = 3.0
    # Server-only HMAC secrets for anonymous poster visitor identifiers and
    # short-lived scan confirmation tokens.
    poster_hash_secret: str = ""
    poster_confirmation_secret: str = ""
    poster_visitor_cookie_path: str = "/qr"
    # Server-only key for encrypting per-account Instagram access tokens before
    # they are stored in Supabase. Generate with Fernet.generate_key().
    instagram_token_encryption_key: str = ""
    # Next.js slide renderer. The carousel slide templates live in the frontend
    # so the admin preview and the published PNG come from one source; this is
    # the route that rasterizes them.
    instagram_slide_render_url: str = ""
    instagram_slide_render_secret: str = ""
    instagram_slide_render_timeout: float = 30.0

    @model_validator(mode="after")
    def validate_database_region(self) -> "Settings":
        if not self.database_url:
            return self

        import urllib.parse

        try:
            parsed = urllib.parse.urlparse(self.database_url)
            host = parsed.hostname
            if not host or not host.endswith(".pooler.supabase.com"):
                return self

            port = parsed.port or 5432
            username = parsed.username
            if not username:
                return self
        except Exception:
            return self

        import socket

        try:
            # Build postgres startup packet to test regional connectivity
            user_str = f"user\x00{username}\x00database\x00postgres\x00\x00"
            packet_len = 8 + len(user_str)
            packet = (
                packet_len.to_bytes(4, byteorder="big")
                + (196608).to_bytes(4, byteorder="big")
                + user_str.encode("utf-8")
            )

            with socket.create_connection((host, port), timeout=3) as s:
                s.sendall(packet)
                response = s.recv(1024)
                if b"not found" in response or b"tenant/user" in response:
                    raise ValueError(
                        f"Database pooler region mismatch: The tenant '{username}' was not found "
                        f"on the pooler host '{host}'. Please verify that the region in your "
                        f"DATABASE_URL matches the remote Supabase database's region."
                    )
        except socket.timeout:
            pass
        except socket.error:
            pass
        return self

    @property
    def is_production(self) -> bool:
        return self.environment.lower() == "production"

    def is_allowed_origin(self, origin: str | None) -> bool:
        if not origin:
            return False
        if origin in set(self.cors_origins or []):
            return True
        if not self.cors_origin_regex:
            return False

        import re

        return re.fullmatch(self.cors_origin_regex, origin) is not None


settings = Settings()
