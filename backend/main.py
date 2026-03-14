from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import auth, users, events, clubs, uploads, qr

app = FastAPI(title="wat2do API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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


@app.get("/health")
async def health():
    return {"status": "ok"}
