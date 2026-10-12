import importlib
import logging
import pkgutil
import threading
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.formparsers import MultiPartParser

import routers as routers_package
from core.config import settings
from core.constants import MAX_IMAGE_SIZE_BYTES
from core.error_handlers import register_error_handlers
from core.security_headers import SecurityHeadersMiddleware
from services import map_location_service

log = logging.getLogger(__name__)

# Keep accepted image uploads in memory through the validated 5 MB limit.
# Production uses a read-only root filesystem, so rolling over at Starlette's
# 1 MB default would fail before our storage validation can run.
MultiPartParser.spool_max_size = MAX_IMAGE_SIZE_BYTES


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    # Every server looks up waiting map locations; they take turns through the database.
    stopping = threading.Event()
    threading.Thread(
        target=map_location_service.run, args=(stopping,), name="map-location-lookups", daemon=True
    ).start()
    yield
    stopping.set()


app = FastAPI(
    title="wat2do API",
    lifespan=lifespan,
    # Disable OpenAPI docs in production to reduce attack surface.
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None if settings.is_production else "/redoc",
    openapi_url=None if settings.is_production else "/openapi.json",
)
register_error_handlers(app)

# Block wildcard origins with credentials - this combination lets any site
# make authenticated requests.  Starlette "reflects" the caller's Origin
# header when allow_origins=["*"] + allow_credentials=True, which is even
# worse than a plain wildcard because the browser sees a valid match.
if "*" in settings.cors_origins:
    raise RuntimeError(
        "CORS_ORIGINS must not contain '*' when credentials are enabled. "
        'Set explicit origins, e.g. CORS_ORIGINS=["https://wat2do.io"]'
    )

# Security headers (CSP, X-Content-Type-Options, X-Frame-Options, etc.).
app.add_middleware(SecurityHeadersMiddleware)

log.info("CORS allowed origins: %s", settings.cors_origins)

# Add CORS last so it is the outermost user middleware and still decorates
# error responses that would otherwise look like browser-side CORS failures.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=settings.cors_origin_regex or None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Auto-discover routers: every module in `routers/` that exports an
# `APIRouter` attribute named `router` is wired automatically, in
# deterministic alphabetical order. Adding a new endpoint set is a single
# file drop - no edit to this file required.
#
# See .claude/rules/backend-architecture.md → "New router checklist".
_registered: list[str] = []
for _mod_info in sorted(pkgutil.iter_modules(routers_package.__path__), key=lambda m: m.name):
    _module = importlib.import_module(f"{routers_package.__name__}.{_mod_info.name}")
    _router = getattr(_module, "router", None)
    if isinstance(_router, APIRouter):
        app.include_router(_router)
        _registered.append(_mod_info.name)

log.info("Registered %d routers: %s", len(_registered), ", ".join(_registered))


@app.get("/health")
async def health():
    return {"status": "ok"}
