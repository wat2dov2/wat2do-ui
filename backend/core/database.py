import ssl
from urllib.parse import urlparse

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from supabase import create_client, Client

from core.config import settings


def _engine_connect_args(database_url: str) -> dict:
    host = urlparse(database_url).hostname
    if not host:
        return {}
    if host in {"localhost", "127.0.0.1"} or host.endswith(".local"):
        return {}
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return {"ssl": ctx}


engine = create_async_engine(
    settings.database_url, echo=False, connect_args=_engine_connect_args(settings.database_url)
)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

supabase: Client = create_client(settings.supabase_url, settings.supabase_key)

supabase_admin: Client | None = (
    create_client(settings.supabase_url, settings.supabase_secret_key)
    if settings.supabase_secret_key
    else None
)


async def get_db() -> AsyncSession:
    async with async_session() as session:
        yield session
