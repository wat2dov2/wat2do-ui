from pydantic_settings import BaseSettings, SettingsConfigDict


# Default origins allowed in local development only.
_DEV_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:3000",
]


class Settings(BaseSettings):
    # `extra="ignore"` — .env holds some shell-only vars (e.g. DATABASE_URL,
    # read by the Supabase CLI) that the Python runtime doesn't need as
    # typed fields. Ignoring them keeps Settings focused on what the app
    # actually reads.
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # "development", "testing", or "production". Controls OpenAPI docs visibility.
    environment: str = "development"

    supabase_url: str
    supabase_key: str
    supabase_secret_key: str = ""
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"
    openai_timeout: int = 15
    openai_temperature_precise: float = 0.3
    openai_temperature_creative: float = 0.7
    # Apify token for the Instagram scraper (services/wat2do).
    # Empty string => the scraping pipeline raises at startup.  Set in
    # GitHub repo secrets for the big-scrape and process-single-user workflows.
    apify_api_token: str = ""
    # OpenAI model used for vision-based event extraction in services/wat2do.
    # Kept separate from ``openai_model`` so we can swap the extraction model
    # (vision-capable) without affecting non-vision call sites.
    openai_extraction_model: str = "gpt-4o-mini"
    # Set CORS_ORIGINS env var as a JSON list for production,
    # e.g. CORS_ORIGINS=["https://wat2do.app","https://www.wat2do.app"]
    cors_origins: list[str] = _DEV_ORIGINS
    cookie_domain: str = ""
    # Secure cookies by default (HTTPS-only). Set COOKIE_SECURE=false for local HTTP dev.
    cookie_secure: bool = True
    # JWT secret for local token verification. Dashboard > Settings > API > JWT Secret.
    supabase_jwt_secret: str = ""
    # Trusted reverse-proxy IPs.  When a request arrives from one of these
    # addresses, ``get_client_ip()`` reads the real client IP from the
    # ``X-Forwarded-For`` / ``X-Real-IP`` headers instead of
    # ``request.client.host``.
    #
    # **Security warning (P2):** The default is *loopback only*.  A broad
    # CIDR range (e.g. the whole Docker bridge ``172.16.0.0/12``) is a
    # spoofing vector: any co-tenant / side-car container with an IP in
    # that range can forge ``X-Forwarded-For`` and impersonate an
    # arbitrary client — bypassing every rate-limit keyed on IP.
    # Deployers **must** explicitly list the proxy's IP (ideally a ``/32``)
    # via the ``TRUSTED_PROXIES`` env var (JSON list); never add a range
    # that shares peers with untrusted workloads.
    trusted_proxies: list[str] = ["127.0.0.1", "::1"]

    # --- Email provider (notifications v1) -------------------------------
    # Empty string => dry-run mode (log-only). Set to ``resend`` or
    # ``postmark`` when wiring the real provider, and populate
    # ``email_provider_api_key`` + ``email_from``.
    email_provider: str = ""
    email_provider_api_key: str = ""
    email_from: str = "wat2do <notifications@wat2do.app>"

    @property
    def is_production(self) -> bool:
        return self.environment.lower() == "production"


settings = Settings()
