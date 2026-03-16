from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env")

    supabase_url: str
    supabase_key: str
    supabase_secret_key: str = ""
    database_url: str = ""  # Optional; only for legacy Alembic/scripts. App uses Supabase client only.


settings = Settings()
