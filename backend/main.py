from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core.config import settings
from core.error_handlers import register_error_handlers
from routers import auth, users, events, clubs, uploads, qr
from routers import (
    interactions, saved_events, recommendations, ab_test, ai,
    credits, submissions, reports, scraped_events,
)

app = FastAPI(title="wat2do API")
register_error_handlers(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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


@app.get("/health")
async def health():
    return {"status": "ok"}
