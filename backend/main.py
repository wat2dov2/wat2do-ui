import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core.config import settings
from core.error_handlers import register_error_handlers
from core.security_headers import SecurityHeadersMiddleware
from routers import auth, users, events, clubs, uploads, qr
from routers import (
    interactions, saved_events, recommendations, ab_test, ai,
    credits, submissions, reports, scraped_events, meta,
)

log = logging.getLogger(__name__)

app = FastAPI(
    title="wat2do API",
    # Disable OpenAPI docs in production to reduce attack surface.
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None if settings.is_production else "/redoc",
    openapi_url=None if settings.is_production else "/openapi.json",
)
register_error_handlers(app)

# Block wildcard origins with credentials — this combination lets any site
# make authenticated requests.  Starlette "reflects" the caller's Origin
# header when allow_origins=["*"] + allow_credentials=True, which is even
# worse than a plain wildcard because the browser sees a valid match.
if "*" in settings.cors_origins:
    raise RuntimeError(
        "CORS_ORIGINS must not contain '*' when credentials are enabled. "
        "Set explicit origins, e.g. CORS_ORIGINS=[\"https://wat2do.app\"]"
    )

log.info("CORS allowed origins: %s", settings.cors_origins)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Security headers (CSP, X-Content-Type-Options, X-Frame-Options, etc.)
# Added after CORS so it wraps every response including preflight.
app.add_middleware(SecurityHeadersMiddleware)

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(events.router)
app.include_router(clubs.router)
app.include_router(uploads.router)
app.include_router(qr.router)
app.include_router(interactions.router)
app.include_router(saved_events.router)
app.include_router(recommendations.router)
app.include_router(ab_test.router)
app.include_router(ai.router)
app.include_router(credits.router)
app.include_router(submissions.router)
app.include_router(reports.router)
app.include_router(scraped_events.router)
app.include_router(meta.router)


@app.get("/health")
async def health():
    return {"status": "ok"}
