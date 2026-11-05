from pydantic_settings import BaseSettings, SettingsConfigDict

# Default origins allowed in local development only.
_DEV_ORIGINS = [
    "http://localhost:3000",
]


class Settings(BaseSettings):
    # `extra="ignore"` - .env holds some shell-only vars that the Python
    # runtime doesn't need as typed fields. Ignoring them keeps Settings
    # focused on what the app actually reads.
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # "development", "testing", or "production". Controls OpenAPI docs visibility.
    environment: str = "development"

    # PostgREST data API in front of Postgres, and the service JWT every
    # backend request carries (it maps to a role that bypasses RLS).
    data_api_url: str
    data_api_key: str = ""
    # Base64 PKCS#8 DER EC P-256 key whose public half verifies our ES256 access
    # tokens (the Rust API signs them).
    auth_signing_key: str = ""
    database_url: str = ""
    # Scoped login the local ingestion agent uses for events and positions.
    ingest_agent_database_url: str = ""
    aws_region: str = "ca-central-1"
    # S3 bucket in ``aws_region`` holding uploaded and ingested media under
    # ``<bucket>/<file>`` keys; CloudFront serves it at STORAGE_PUBLIC_BASE_URL.
    storage_bucket_name: str = ""
    storage_public_base_url: str = ""
    openai_api_key: str = ""
    # Required only for manual username lookups and profile-logo backfills.
    apify_api_token: str = ""
    # Vision-capable model shared by event extraction and reconciliation.
    openai_extraction_model: str = "gpt-6-luna"
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

    # --- Email (Amazon SES) ----------------------------------------------
    # False => dry-run mode (log-only). True sends through Amazon SES in
    # ``aws_region`` with the runtime's AWS credentials.
    email_delivery_enabled: bool = False
    email_from: str = "wat2do <notifications@wat2do.io>"
    frontend_url: str = "http://localhost:3000"
    email_unsubscribe_secret: str = ""
    event_feed_revalidation_url: str = ""
    event_feed_revalidation_secret: str = ""
    event_feed_revalidation_timeout: float = 3.0
    # Server-only key for encrypting per-account Instagram access tokens before
    # they are stored in the database. Generate with Fernet.generate_key().
    instagram_token_encryption_key: str = ""
    # Next.js slide renderer. The carousel slide templates live in the frontend
    # so the admin preview and the published PNG come from one source; this is
    # the route that rasterizes them.
    instagram_slide_render_url: str = ""
    instagram_slide_render_secret: str = ""
    instagram_slide_render_timeout: float = 30.0
    automate_webhook_key: str = ""
    # Bearer key the scheduled event change alerts call sends to its webhook.
    event_change_alerts_key: str = ""

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
