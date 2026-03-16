# Backend

FastAPI + Supabase only. No SQLAlchemy, no direct Postgres connection, no pgbouncer issues.

- **Auth & storage**: Supabase client
- **Data**: Supabase PostgREST (tables: `users`, `events`, `clubs`, `qr_codes`, `qr_code_scans`). Create these in the Supabase SQL editor or via Supabase CLI migrations.

## Prerequisites

- Python 3.10+
- A Supabase project (dashboard.supabase.com)

## Setup

1. **Create a virtual environment** (recommended):

   ```bash
   python -m venv .venv
   source .venv/bin/activate   # On Windows: .venv\Scripts\activate
   ```

2. **Install dependencies**:

   ```bash
   pip install -r requirements.txt
   ```

3. **Configure environment**:

   ```bash
   cp .env.example .env
   ```

   Edit `.env`:

   - `SUPABASE_URL` – project URL (e.g. `https://xxxx.supabase.co`)
   - `SUPABASE_KEY` – anon/public key
   - `SUPABASE_SECRET_KEY` – **service role** key (Dashboard → Settings → API). Required for backend table access.

## Running the server

From the `backend` directory, use the **venv’s Python** so the reloader subprocess uses the venv too (avoids Anaconda/system Python):

```bash
.venv/bin/python -m uvicorn main:app --reload
```

Use `.venv/bin/python -m uvicorn` if the reloader picks up the wrong Python.

- API: **http://127.0.0.1:8000**
- Health: **http://127.0.0.1:8000/health**
- Docs: **http://127.0.0.1:8000/docs**

## API Routes

### Public (no auth required)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/events/` | List events (supports `search`, `category`, `club_type`, `school`, `from_date`, `to_date`, `has_food`, `max_price`, `registration` filters) |
| GET | `/events/{id}` | Get event by ID |
| GET | `/clubs/` | List clubs (supports `search`, `club_type` filters) |
| GET | `/clubs/{id}` | Get club by ID |

### Auth

| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/signup` | Create account (Supabase + DB user row) |
| POST | `/auth/login` | Login, returns access/refresh tokens |
| POST | `/auth/refresh` | Refresh access token |
| POST | `/auth/logout` | Logout (requires Bearer token) |
| POST | `/auth/forgot-password` | Send password reset email |
| POST | `/auth/reset-password` | Reset password with token |

### Protected (requires Bearer token)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/users/me` | Get current user profile |
| PATCH | `/users/me` | Update current user profile |
| PATCH | `/users/me/profile` | Update onboarding fields (faculty, interests, school, is_first_year) |
| GET | `/users/` | List all users |
| GET | `/users/{id}` | Get user by ID |
| DELETE | `/users/{id}` | Delete user |
| POST | `/events/` | Create event |
| PATCH | `/events/{id}` | Update event |
| DELETE | `/events/{id}` | Delete event |
| POST | `/clubs/` | Create club |
| PATCH | `/clubs/{id}` | Update club |
| DELETE | `/clubs/{id}` | Delete club |

## Database schema

Create tables in Supabase (SQL Editor or CLI). The app expects:

- `users` (id UUID PK, supabase_auth_id, email, username, full_name, avatar_url, faculty, school, interests JSONB, is_first_year, created_at, updated_at)
- `events` (id bigserial PK, title, description, location, dtstart_utc, dtend_utc, price, food JSONB, registration, source_image_url, club_type, school, source_url, category, organization, ig_handle, discord_handle, x_handle, tiktok_handle, fb_handle, other_handle, display_handle, added_at)
- `clubs` (id bigserial PK, club_name, categories JSONB, club_page, ig, discord, club_type, logo_url)
- `qr_codes` (id text PK, name, description, destination_type, destination_id, filters JSONB, created_at, created_by, is_active, image_url, latitude, longitude)
- `qr_code_scans` (id UUID PK, qr_code_id FK, scanned_at, user_id, session_id, conversion_actions JSONB, user_agent)

Use your existing Alembic migration SQL or Supabase migrations to create these.

## Seeding the database

With venv activated and tables created:

```bash
python seeds/run.py
```

Seeds users, events, and clubs.

## Tests

With venv activated:

```bash
python -m pytest -v
```

## Quick reference

All commands assume the venv is activated (`source .venv/bin/activate`). Using `python -m ...` ensures the venv’s tools are used, not your system/global ones.

| Task              | Command                               |
|-------------------|---------------------------------------|
| Start dev server  | `python -m uvicorn main:app --reload` |
| Seed database     | `python seeds/run.py`                 |
| Run tests         | `python -m pytest -v`                |
