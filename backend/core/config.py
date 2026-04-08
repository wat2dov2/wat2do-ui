from pydantic_settings import BaseSettings, SettingsConfigDict


# Default origins allowed in local development only.
_DEV_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:3000",
]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env")

    supabase_url: str
    supabase_key: str
    supabase_secret_key: str = ""
    database_url: str = ""  # Optional; only for legacy Alembic/scripts. App uses Supabase client only.
    openai_api_key: str = ""
    # Set CORS_ORIGINS env var as a JSON list for production,
    # e.g. CORS_ORIGINS=["https://wat2do.app","https://www.wat2do.app"]
    cors_origins: list[str] = _DEV_ORIGINS
    cookie_domain: str = ""
    # Secure cookies by default (HTTPS-only). Set COOKIE_SECURE=false for local HTTP dev.
    cookie_secure: bool = True
    # JWT secret for local token verification. Dashboard > Settings > API > JWT Secret.
    supabase_jwt_secret: str = ""


settings = Settings()
