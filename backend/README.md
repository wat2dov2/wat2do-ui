# Backend

FastAPI backend with PostgreSQL (async via asyncpg), Supabase auth, and Alembic migrations.

## Prerequisites

- Python 3.10+
- PostgreSQL (e.g. via Supabase)

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

   Copy the example env file and fill in your values:

   ```bash
   cp .env.example .env
   ```

   Edit `.env` and set:

   - `SUPABASE_URL` – your Supabase project URL
   - `SUPABASE_KEY` – your Supabase anon/publishable key
   - `SUPABASE_SECRET_KEY` – (optional) secret key (`sb_secret_...`) for server-side operations that bypass RLS (storage uploads, admin client). Get from Dashboard → Settings → API Keys.
   - `DATABASE_URL` – PostgreSQL connection string (async driver).

     Use the Supabase **pooler** hostname from the dashboard (Project Settings → Database → Connection string):

     `postgresql+asyncpg://postgres.<PROJECT_REF>:<DB_PASSWORD>@aws-0-<REGION>.pooler.supabase.com:5432/postgres`

## Running the server

From the `backend` directory:

```bash
uvicorn main:app --reload
```

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

## Migrations (Alembic)

Run from the `backend` directory. The app uses `DATABASE_URL` from `.env`.

```bash
alembic upgrade head                          # Apply all pending migrations
alembic revision --autogenerate -m "message"  # Create new migration
alembic downgrade -1                          # Roll back one revision
alembic current                               # Show current revision
alembic history                               # Show migration history
```

## Seeding the database

After migrations are applied:

```bash
python seeds/run.py
```

Seeds users, events, and clubs.

## Tests

```bash
pytest -v
```

## Quick reference

| Task              | Command                    |
|-------------------|----------------------------|
| Start dev server  | `uvicorn main:app --reload` |
| Run migrations    | `alembic upgrade head`      |
| New migration     | `alembic revision --autogenerate -m "message"` |
| Seed database     | `python seeds/run.py`       |
| Run tests         | `pytest -v`                 |
