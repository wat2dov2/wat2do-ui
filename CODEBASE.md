# wat2do-v2 — Master Codebase Reference

> This document is the single source of truth for any AI agent working on this codebase.
> It describes the architecture, conventions, data flow, and every feature's end-to-end wiring.
> **Last audited: 2026-03-10**

---

## 1. Project Overview

**wat2do** is a university events and clubs discovery platform targeting students at Canadian universities (primarily University of Waterloo). Students can browse events, discover clubs, submit events, and manage their profiles.

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite 7, Tailwind CSS v4, React Router v7 |
| Backend | Python 3.12+, FastAPI, SQLAlchemy 2 (async), Pydantic v2 |
| Database | PostgreSQL (via Supabase) with asyncpg driver |
| Auth | Supabase Auth (JWT-based, email/password) |
| Storage | Supabase Storage (S3-compatible buckets) |
| ORM/Migrations | SQLAlchemy + Alembic |
| Deployment | Docker Compose (backend on port 8000, frontend nginx on port 3000) |

### Monorepo Structure

```
wat2do-v2/
├── backend/                  # FastAPI Python backend
│   ├── main.py               # App entrypoint, mounts routers
│   ├── core/                 # Config, database, auth, logging
│   ├── models/               # SQLAlchemy ORM models
│   ├── schemas/              # Pydantic request/response schemas
│   ├── services/             # Business logic layer
│   ├── routers/              # FastAPI route handlers (thin)
│   ├── migrations/           # Alembic migrations
│   ├── seeds/                # Seed data scripts
│   ├── scripts/              # Utility scripts
│   └── tests/                # pytest tests
├── frontend/                 # React SPA
│   ├── src/
│   │   ├── App.tsx           # Root component, routing, state orchestration
│   │   ├── main.tsx          # Entry point, i18n init, BrowserRouter
│   │   ├── app/              # App-level layout, hooks, routes
│   │   ├── features/         # Feature modules (auth, events, clubs, etc.)
│   │   ├── shared/           # Shared types, UI components, services, hooks
│   │   ├── contexts/         # React Context providers
│   │   └── locales/          # i18n translation files
│   ├── e2e/                  # Playwright E2E tests
│   └── public/               # Static assets
├── docker-compose.yml
└── CODEBASE.md               # This file
```

---

## 2. Backend Architecture

### 2.1 Layered Architecture

```
Request → Router → Service → Database (SQLAlchemy)
                 ↘ Supabase Auth (for auth operations)
                 ↘ Supabase Storage (for file uploads)
```

**Routers** are thin — they validate input, call services, and raise HTTP exceptions.
**Services** contain all business logic. They accept `AsyncSession` as their first argument and never raise HTTP exceptions (exception: `auth_service` raises for auth-specific errors).

### 2.2 Models (SQLAlchemy ORM)

#### User (`models/user.py` → `users` table)
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Primary key, auto-generated |
| `supabase_auth_id` | String(255) | Unique, indexed — links to Supabase Auth |
| `email` | String(255) | Unique |
| `username` | String(100) | Unique, nullable |
| `full_name` | String(255) | Nullable |
| `avatar_url` | String(512) | Nullable |
| `faculty` | String(255) | Nullable |
| `school` | String(255) | Nullable |
| `interests` | JSONB | Default empty list |
| `is_first_year` | Boolean | Default false |
| `created_at` | DateTime(tz) | Server default now() |
| `updated_at` | DateTime(tz) | Server default now(), onupdate now() |

#### Event (`models/event.py` → `events` table)
| Column | Type | Notes |
|--------|------|-------|
| `id` | Integer | Primary key, autoincrement |
| `title` | String(500) | Required |
| `description` | Text | Nullable |
| `location` | String(500) | Required |
| `dtstart_utc` | DateTime(tz) | Nullable |
| `dtend_utc` | DateTime(tz) | Nullable |
| `price` | Float | Nullable |
| `food` | JSONB | Nullable, list of food types |
| `registration` | Boolean | Default false |
| `source_image_url` | String(1024) | Nullable |
| `club_type` | String(100) | Nullable (e.g., "WUSA", "University") |
| `school` | String(255) | Nullable |
| `source_url` | String(1024) | Nullable |
| `category` | String(100) | Nullable |
| `organization` | String(255) | Required (validated in schema) |
| `ig_handle` | String(255) | Nullable |
| `discord_handle` | String(255) | Nullable |
| `x_handle` | String(255) | Nullable |
| `tiktok_handle` | String(255) | Nullable |
| `fb_handle` | String(255) | Nullable |
| `other_handle` | String(255) | Nullable |
| `display_handle` | String(255) | Nullable |
| `added_at` | DateTime(tz) | Server default now() |

#### Club (`models/club.py` → `clubs` table)
| Column | Type | Notes |
|--------|------|-------|
| `id` | Integer | Primary key, autoincrement |
| `club_name` | String(500) | Required |
| `categories` | JSONB | Default empty list |
| `club_page` | String(500) | Nullable |
| `ig` | String(255) | Nullable |
| `discord` | String(255) | Nullable |
| `club_type` | String(100) | Required (e.g., "WUSA", "University") |
| `logo_url` | String(1024) | Nullable |

### 2.3 Schemas (Pydantic v2)

All response schemas use `model_config = {"from_attributes": True}` for ORM compatibility.

- **Auth**: `SignupRequest`, `LoginRequest`, `RefreshRequest`, `ForgotPasswordRequest`, `ResetPasswordRequest`, `TokenResponse`, `SignupResponse`, `MessageResponse`
- **User**: `UserUpdate`, `UserProfileUpdate`, `UserResponse`
- **Event**: `EventCreate` (organization required), `EventUpdate`, `EventResponse`
- **Club**: `ClubCreate` (club_type required), `ClubUpdate`, `ClubResponse`

### 2.4 API Endpoints

#### Auth (`/auth`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/signup` | No | Create account via Supabase Auth + DB user row |
| POST | `/auth/login` | No | Login via Supabase Auth, returns JWT tokens |
| POST | `/auth/refresh` | No | Refresh expired access token |
| POST | `/auth/logout` | Bearer | Sign out of Supabase |
| POST | `/auth/forgot-password` | No | Send password reset email |
| POST | `/auth/reset-password` | No | Reset password with token |

#### Users (`/users`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/users/me` | Bearer | Get current user's profile |
| PATCH | `/users/me` | Bearer | Update current user (all fields) |
| PATCH | `/users/me/profile` | Bearer | Update onboarding fields only |
| GET | `/users/` | Bearer | List all users (admin) |
| GET | `/users/{user_id}` | Bearer | Get user by ID |
| DELETE | `/users/{user_id}` | Bearer | Delete user |

#### Events (`/events`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/events/` | No | List events with optional filters |
| GET | `/events/{event_id}` | No | Get single event |
| POST | `/events/` | Bearer | Create event |
| PATCH | `/events/{event_id}` | Bearer | Update event |
| DELETE | `/events/{event_id}` | Bearer | Delete event |

**List events query params**: `skip`, `limit`, `category`, `club_type`, `school`, `search`, `from_date`, `to_date`, `has_food`, `max_price`, `registration`

#### Clubs (`/clubs`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/clubs/` | No | List clubs with optional filters |
| GET | `/clubs/{club_id}` | No | Get single club |
| POST | `/clubs/` | Bearer | Create club |
| PATCH | `/clubs/{club_id}` | Bearer | Update club |
| DELETE | `/clubs/{club_id}` | Bearer | Delete club |

**List clubs query params**: `skip`, `limit`, `club_type`, `search`

#### Uploads (`/uploads`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/uploads/event-image/{event_id}` | Bearer | Upload event image |
| POST | `/uploads/avatar` | Bearer | Upload user avatar |
| POST | `/uploads/club-logo/{club_id}` | Bearer | Upload club logo |
| POST | `/uploads/qr-asset` | Bearer | Upload QR code asset |

All upload endpoints accept `multipart/form-data` with a `file` field. Returns `{ "url": "..." }`.

### 2.5 Auth Flow

1. Supabase Auth handles signup/login/token management
2. On signup, a row is created in the `users` table linked by `supabase_auth_id`
3. Bearer tokens (Supabase JWTs) are validated via `core/auth.py` → `get_current_user`
4. Only student emails from allowed domains can sign up (see `core/allowed_emails.py`)

**Allowed email domains** (backend):
- `uwaterloo.ca` → University of Waterloo
- `edu.uwaterloo.ca` → University of Waterloo
- `wlu.ca` → Wilfrid Laurier University
- `mylaurier.ca` → Wilfrid Laurier University
- `uoguelph.ca` → University of Guelph
- `conestogac.on.ca` → Conestoga College

### 2.6 Storage Buckets

Managed via `services/storage_service.py`. Supabase Storage buckets:

| Bucket | Public | Max Size | Allowed MIME Types |
|--------|--------|----------|-------------------|
| `event-images` | Yes | 5 MB | jpeg, png, webp, gif |
| `avatars` | Yes | 2 MB | jpeg, png, webp |
| `club-logos` | Yes | 2 MB | jpeg, png, webp, svg+xml |
| `qr-assets` | Yes | 5 MB | jpeg, png, webp, svg+xml |

### 2.7 Configuration

**Environment variables** (backend `.env`):
- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_KEY` — Supabase anon/public key
- `SUPABASE_SECRET_KEY` — (optional) Service role key for admin operations
- `DATABASE_URL` — PostgreSQL connection string (format: `postgresql+asyncpg://...`)

The database engine uses SSL for remote connections (non-localhost). See `core/database.py`.

---

## 3. Frontend Architecture

### 3.1 Feature-Based Module Structure

Each feature is self-contained in `src/features/<name>/`:

```
features/<name>/
├── api/             # Public API layer (calls backend + local storage)
├── components/      # React components
├── hooks/           # React hooks (state + logic)
├── store/           # State management (React hooks, NOT Redux)
├── pages/           # Page-level components
├── data/            # Static data / constants
├── context/         # React Context (if needed)
└── index.ts         # Public barrel export
```

### 3.2 Features & Their Backend Wiring

#### Auth (`features/auth/`) — FULLY BACKEND-WIRED
- **Pages**: `AuthEntryPage` (login/signup), `OnboardingPage` (profile setup)
- **API calls**: `POST /auth/signup`, `POST /auth/login`, `POST /auth/logout`, `POST /auth/refresh`, `GET /users/me`, `PATCH /users/me/profile`
- **State**: `useAuthStore` (email, profile, isAuthenticated, profileCompleted) backed by localStorage + API tokens
- **Tokens**: Stored in localStorage as `wat2do_access_token` and `wat2do_refresh_token`
- **Profile data**: Cached in localStorage as `userProfile`, synced with backend on login/update

#### Events (`features/events/`) — FULLY BACKEND-WIRED
- **Pages**: `EventsPageContainer` (main events view)
- **API calls**: `GET /events/`, `POST /events/`, `PATCH /events/{id}`, `DELETE /events/{id}`
- **State**: `useEventsStore` fetches from API on mount, manages local state for CRUD
- **Components**: `EventCard`, `EventDetailsModal`, `SubmitEventModal`, `EventForm`
- **Fallback**: If API calls fail, falls back to local event creation (offline-resilient)

#### Clubs (`features/clubs/`) — FULLY BACKEND-WIRED
- **Pages**: `ClubsPage`
- **API calls**: `GET /clubs/`, `POST /clubs/`, `PATCH /clubs/{id}`, `DELETE /clubs/{id}`
- **Components**: `ClubCard`, `AddClubModal`
- **Filtering**: Client-side via `clubService.ts` (search, category, type)

#### Search (`features/search/`) — CLIENT-SIDE ONLY
- **Purpose**: Filter and sort events on the client
- **No backend calls** — all filtering happens in `searchService.ts`
- **State**: `useFilterState` reducer manages all filter parameters
- **Hooks**: `useSearch` orchestrates filtering, sorting, pie menus

#### Settings (`features/settings/`) — MIXED
- **Profile tab**: Calls `PATCH /users/me/profile` (backend-wired) and `POST /uploads/avatar`
- **Notifications, Privacy, Appearance**: localStorage-only (no backend endpoints)

#### Admin (`features/admin/`) — MIXED
- **Events management**: Backend-wired via events API
- **Clubs management**: Backend-wired via clubs API
- **Event submissions**: localStorage-only (`StorageService`)
- **Reported events**: localStorage-only (`StorageService`)
- **Scraped events**: localStorage-only (`StorageService`)
- **QR Codes (via qrcode feature)**: localStorage-only
- **Posters**: localStorage-only

#### Credits/Promotions (`features/credits/`) — LOCAL-ONLY
- All credits, promotions, and payment logic is localStorage-based
- No backend endpoints exist for credits

#### QR Codes (`features/qrcode/`) — LOCAL-ONLY
- QR code creation, scanning, tracking — all localStorage-based
- The `POST /uploads/qr-asset` endpoint exists for image uploads only

#### Marketing (`features/marketing/`) — LOCAL-ONLY
- QR poster marketing page
- No dedicated backend endpoints

#### Club Panel (`features/club-panel/`) — UI SHELL
- Pages: `ClubPanel`, `ClubPanelPostersPage`, `ClubPanelIntegrationsPage`, `ClubPanelMembersPage`
- These are admin-like pages for club managers

#### About (`features/about/`) — STATIC
- Static about page with newsletter form (no backend)

#### Commands (`features/commands/`) — CLIENT-ONLY
- Command palette (Cmd+K) for quick navigation/actions

### 3.3 Shared Layer (`src/shared/`)

#### Types (`shared/types/`)
- `event.types.ts` — `Event`, `EventFormData`, `UserEventState`, `ValidationErrors`
- `common.types.ts` — `ViewMode`, `PageMode`, `Club`
- `filter.types.ts` — `FilterState`, `FilterViewMode`, `QuickFilterConfig`
- `promotion.types.ts` — `PromotedEvent`, `PromotionPackage`, `PROMOTION_PACKAGES`, `CREDIT_PACKAGES`
- `admin.types.ts` — `EventSubmission`, `ReportedEvent`, `ScrapedEvent`
- `qrcode.types.ts` — `QRCode`, `QRCodeScan`

#### Services (`shared/services/`)
- `apiClient.ts` — HTTP client wrapping `fetch` with JWT auth headers, base URL from `VITE_API_URL`
- `uploadService.ts` — File upload helpers (FormData, bypasses JSON apiClient)
- `storageService.ts` — localStorage abstraction (typed get/set/remove)

#### UI Components (`shared/ui/`)
- Built on Radix UI primitives + shadcn/ui patterns
- Includes: button, input, dialog, select, tabs, badge, card, separator, tooltip, switch, popover, etc.
- Custom: `LoadingButton`, `LoadingPage`, `Spinner`, `TagInput`, `ImageUploadField`, `FormField` variants

### 3.4 State Management Patterns

**No global state library** — state is managed via:
1. **React hooks** (`useState`, `useReducer`, `useCallback`, `useMemo`)
2. **Custom store hooks** (`useAuthStore`, `useEventsStore`) that sync with localStorage
3. **React Context** (`AppContext`, `NavigationContext`) for cross-component state
4. **localStorage** for persistence across sessions (via `StorageService`)

State flows **top-down** from `App.tsx`:
```
App.tsx
├── useAppEvents()    → events CRUD
├── useAppUI()        → UI state (modals, view mode, profile)
├── useSavedEvents()  → saved event IDs
├── useSearch()       → filter/sort state
├── useAppPromotions() → credits/promotions
├── useAppNavigation() → page mode, URL params
└── useEasterEggs()   → easter egg state
```

### 3.5 Routing

| Path | Component | Auth Required |
|------|-----------|--------------|
| `/` | `EventsPageContainer` | No |
| `/auth` | `AuthEntryPage` | No |
| `/onboarding` | `OnboardingPage` | No |
| `/about` | `AboutPage` | No |
| `/clubs` | `ClubsPage` | No |
| `/settings` | `SettingsPage` | Yes |
| `/admin` | `AdminPanel` | Yes |
| `/admin/events` | `AdminEventsPage` | Yes |
| `/admin/clubs` | `AdminClubsPage` | Yes |
| `/admin/submissions` | `AdminSubmissionsPage` | Yes |
| `/admin/posters` | `AdminPostersPage` | Yes |
| `/marketing` | `MarketingPage` | Yes |
| `/club-panel` | `ClubPanel` | Yes |
| `/club-panel/posters` | `ClubPanelPostersPage` | Yes |
| `/club-panel/integrations` | `ClubPanelIntegrationsPage` | Yes |
| `/club-panel/members` | `ClubPanelMembersPage` | Yes |

Protected routes use `<ProtectedRoute>` which checks `isAuthenticated()` and redirects to `/auth`.

### 3.6 API Client (`shared/services/apiClient.ts`)

```typescript
const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
```

- Automatically attaches `Authorization: Bearer <token>` from localStorage
- Methods: `api.get<T>()`, `api.post<T>()`, `api.patch<T>()`, `api.delete<T>()`
- Throws `ApiError` with `.status` and `.body` on non-2xx responses
- Returns `undefined` for 204 No Content

**Upload service** (`shared/services/uploadService.ts`) uses raw `fetch` with `FormData` (not JSON).

### 3.7 i18n

- Uses `react-i18next` with a single English locale (`locales/en.json`)
- Language loaded async before app render in `main.tsx`
- All user-facing strings use `t()` translation keys

---

## 4. Database

### 4.1 Connection

- PostgreSQL via Supabase (cloud-hosted)
- Connection string format: `postgresql+asyncpg://user:pass@host:5432/postgres`
- SSL enabled for remote connections (non-localhost)
- Async sessions via `sqlalchemy.ext.asyncio`

### 4.2 Migrations

Managed by Alembic. Migration files in `backend/migrations/versions/`:
1. `c014bad36b49` — Create users table
2. `20d14ccc324f` — Add events, clubs tables and user profile fields
3. `503d6872629d` — Require event organization field
4. `be3c90f6a8e8` — Add logo_url to clubs

**To create a new migration:**
```bash
cd backend
alembic revision --autogenerate -m "description"
alembic upgrade head
```

### 4.3 Seeds

Seed script: `python seeds/run.py` — seeds users, events (30), and clubs (5).
Seed data is idempotent (checks for existing records by title/name before inserting).

---

## 5. Conventions & Opinions

### 5.1 Backend Conventions

1. **One file per entity** across models/, schemas/, services/, routers/
2. **Services never raise HTTP exceptions** — they return `None` or `False`, routers translate to 404
3. **All DB operations are async** — `await db.execute()`, `await db.commit()`
4. **JSONB for list fields** — interests, categories, food are all `JSONB` columns
5. **Pydantic v2** — use `model_config = {"from_attributes": True}` on response models
6. **Auth via dependency injection** — `Depends(get_current_user)` for protected routes
7. **Public read, protected write** — GET endpoints for events/clubs are public; POST/PATCH/DELETE require auth

### 5.2 Frontend Conventions

1. **Feature modules are self-contained** — each feature has its own api/, hooks/, components/, pages/
2. **Public API pattern** — features export through `index.ts` barrel files; other features import from the barrel, not internal files
3. **Hooks over classes** — all state management uses React hooks
4. **No global state library** — Context + custom hooks + localStorage
5. **Graceful degradation** — API failures fall back to local operations where possible
6. **Lazy loading** — pages are lazy-loaded via `React.lazy()` for code splitting
7. **Radix + shadcn/ui** — all UI primitives come from Radix; styled with Tailwind CSS v4
8. **Translation keys everywhere** — no hardcoded strings; use `t("key")` from react-i18next

### 5.3 Naming Conventions

| Layer | Convention | Example |
|-------|-----------|---------|
| Backend models | PascalCase singular | `User`, `Event`, `Club` |
| Backend tables | snake_case plural | `users`, `events`, `clubs` |
| Backend services | `<entity>_service.py` | `event_service.py` |
| Backend schemas | `<Entity>Create/Update/Response` | `EventCreate` |
| Frontend features | kebab-case folders | `features/club-panel/` |
| Frontend hooks | `use<Name>` | `useAuth`, `useEventsStore` |
| Frontend API files | `<feature>.api.ts` | `events.api.ts` |
| Frontend types | `<name>.types.ts` | `event.types.ts` |
| CSS | Tailwind utility classes | No CSS modules or styled-components |

### 5.4 Error Handling

- **Backend**: Services return `None`; routers raise `HTTPException(404)`. Auth service raises `HTTPException` directly.
- **Frontend**: `ApiError` class with `.status` and `.body`. Caught in hooks, surfaced to UI via state.
- **Silent fallbacks**: Event/club CRUD catches API errors and falls back to local operations.

### 5.5 Adding a New Entity (End-to-End Checklist)

1. **Backend model** — `models/<entity>.py`, import `Base` from `models.user`
2. **Register model** — add import to `models/__init__.py`
3. **Schema** — `schemas/<entity>.py` with Create, Update, Response models
4. **Service** — `services/<entity>_service.py` with async CRUD functions
5. **Router** — `routers/<entity>.py` with APIRouter, public reads, protected writes
6. **Mount router** — import in `main.py`, `app.include_router()`
7. **Migration** — `alembic revision --autogenerate`, then `alembic upgrade head`
8. **Seed** — `seeds/<entity>.py`, import in `seeds/run.py`
9. **Frontend type** — add interface to `shared/types/`
10. **Frontend API** — `features/<entity>/api/<entity>.api.ts` calling backend endpoints
11. **Frontend hook/store** — `features/<entity>/hooks/` or `store/`
12. **Frontend page** — `features/<entity>/pages/`
13. **Route** — add to `App.tsx` routes
14. **Tests** — backend: `tests/routers/`, `tests/services/`; frontend: e2e in `e2e/`

---

## 6. End-to-End Feature Status

### Fully Backend-Wired (working end-to-end)

| Feature | Frontend → Backend | Status |
|---------|-------------------|--------|
| Signup | `POST /auth/signup` → Supabase Auth + DB user | ✅ |
| Login | `POST /auth/login` → Supabase Auth | ✅ |
| Logout | `POST /auth/logout` → Supabase Auth | ✅ |
| Token refresh | `POST /auth/refresh` → Supabase Auth | ✅ |
| Get profile | `GET /users/me` → DB | ✅ |
| Update profile | `PATCH /users/me/profile` → DB | ✅ |
| List events | `GET /events/` → DB | ✅ |
| Create event | `POST /events/` → DB | ✅ |
| Update event | `PATCH /events/{id}` → DB | ✅ |
| Delete event | `DELETE /events/{id}` → DB | ✅ |
| List clubs | `GET /clubs/` → DB | ✅ |
| Create club | `POST /clubs/` → DB | ✅ |
| Update club | `PATCH /clubs/{id}` → DB | ✅ |
| Delete club | `DELETE /clubs/{id}` → DB | ✅ |
| Upload event image | `POST /uploads/event-image/{id}` → Supabase Storage | ✅ |
| Upload avatar | `POST /uploads/avatar` → Supabase Storage | ✅ |
| Upload club logo | `POST /uploads/club-logo/{id}` → Supabase Storage | ✅ |
| Upload QR asset | `POST /uploads/qr-asset` → Supabase Storage | ✅ |

### Frontend-Only (localStorage, no backend)

These features work fully in the frontend but have no backend persistence:

| Feature | Storage | Notes |
|---------|---------|-------|
| Event search/filter/sort | In-memory | Pure client-side filtering of backend data |
| Saved events | localStorage | Event IDs saved locally |
| Credits & promotions | localStorage | No payment backend |
| QR code CRUD | localStorage | Create/edit/delete QR codes locally |
| QR scan tracking | localStorage | Scan analytics stored locally |
| Event submissions (admin) | localStorage | Moderation queue stored locally |
| Reported events (admin) | localStorage | Report queue stored locally |
| Scraped events (admin) | localStorage | Scraper results stored locally |
| Notification prefs | localStorage | No push notification backend |
| Privacy prefs | localStorage | UI preference only |
| Appearance (theme, view mode) | localStorage | UI preference only |
| Onboarding checklist | localStorage | Getting started progress |
| Command palette | In-memory | Cmd+K search, no persistence |

---

## 7. Data Flow Diagrams

### 7.1 Auth Flow

```
Frontend                          Backend                    Supabase
────────                          ───────                    ────────
AuthEntryPage
  ↓ email + password
useAuthEntryFlow
  ↓ signupAPI() ──────────→ POST /auth/signup ──────→ auth.sign_up()
  ↓                           ↓ create User row            ↓ returns session
  ↓ saveTokens(access, refresh)←── SignupResponse ←────── JWT tokens
  ↓ saveUserEmail()
  ↓
OnboardingPage
  ↓ faculty, interests, school
useAuth.updateProfile()
  ↓ updateProfileAPI() ──→ PATCH /users/me/profile ──→ DB update
  ↓ saveUserProfile()
  ↓
Protected routes check isAuthenticated() → has tokens + email in localStorage
```

### 7.2 Events Flow

```
Frontend                          Backend                    Database
────────                          ───────                    ────────
App.tsx → useAppEvents()
  ↓ useEventsStore()
  ↓ fetchAllEvents() ─────→ GET /events/ ──────────→ SELECT * FROM events
  ↓ setEvents(apiEvents)        ↓ EventResponse[]
  ↓
  ↓ (user creates event)
  ↓ createEventAPI() ─────→ POST /events/ ─────────→ INSERT INTO events
  ↓ setEvents([created, ...prev])                       ↓ returns Event
  ↓
  ↓ (user filters/searches)
  ↓ useSearch() → filterEvents() → sortEvents()    (client-side only)
  ↓ filteredEvents rendered in EventsPageContainer
```

### 7.3 Upload Flow

```
Frontend                          Backend                    Supabase Storage
────────                          ───────                    ────────────────
uploadService.ts
  ↓ FormData with file
  ↓ uploadEventImage() ──→ POST /uploads/event-image/{id}
                              ↓ validate size + MIME
                              ↓ storage_service.upload_file()──→ bucket.upload()
                              ↓ update event.source_image_url    ↓ returns public URL
                              ↓ { "url": "..." } ←──────────────
```

---

## 8. Environment Setup

### 8.1 Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # Fill in Supabase credentials + DATABASE_URL
alembic upgrade head
python seeds/run.py   # Optional: seed data
uvicorn main:app --reload
```

### 8.2 Frontend

```bash
cd frontend
npm install
cp .env.example .env  # Set VITE_API_URL=http://localhost:8000
npm run dev
```

### 8.3 Docker (Production)

```bash
docker compose up --build
# Backend: http://localhost:8000
# Frontend: http://localhost:3000 (nginx proxies /api → backend)
```

### 8.4 Required Env Vars

**Backend `.env`:**
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-anon-key
SUPABASE_SECRET_KEY=your-service-role-key  # optional
DATABASE_URL=postgresql+asyncpg://user:pass@host:5432/postgres
```

**Frontend `.env`:**
```
VITE_API_URL=http://localhost:8000
```

---

## 9. Testing

### Backend
```bash
cd backend
pytest -v                          # Run all tests
pytest tests/routers/ -v           # Router tests only
pytest tests/services/ -v          # Service tests only
```

Test files mirror the source structure:
- `tests/routers/test_users.py`, `test_events.py`, `test_clubs.py`
- `tests/services/test_user_service.py`
- `tests/conftest.py` — shared fixtures

### Frontend
```bash
cd frontend
npm run lint          # ESLint
npm run type-check    # TypeScript type checking
npm run check         # Both lint + type-check
npx playwright test   # E2E tests
```

---

## 10. Key Dependencies

### Backend (Python)
| Package | Purpose |
|---------|---------|
| `fastapi` | Web framework |
| `uvicorn` | ASGI server |
| `sqlalchemy` | ORM (async) |
| `asyncpg` | PostgreSQL async driver |
| `alembic` | Database migrations |
| `supabase` | Supabase client (auth + storage) |
| `pydantic` | Data validation |
| `pydantic-settings` | Environment config |
| `python-multipart` | File upload support |

### Frontend (TypeScript)
| Package | Purpose |
|---------|---------|
| `react` + `react-dom` | UI framework |
| `react-router-dom` | Client-side routing |
| `@radix-ui/*` | UI primitives |
| `tailwindcss` v4 | Utility CSS |
| `framer-motion` / `motion` | Animations |
| `react-i18next` / `i18next` | Internationalization |
| `recharts` | Charts (admin analytics) |
| `mapbox-gl` / `react-map-gl` | Map view |
| `qrcode.react` | QR code generation |
| `date-fns` | Date utilities |
| `cmdk` | Command palette |
| `ai` / `@ai-sdk/openai` | AI-powered event form generation |

---

## 11. Common Patterns for AI Agents

### When adding a new feature:
1. Read this document first
2. Follow Section 5.5 (End-to-End Checklist)
3. Match existing naming conventions (Section 5.3)
4. Use existing patterns from similar features

### When modifying an existing feature:
1. Check Section 6 to understand if it's backend-wired or local-only
2. Read the feature's `api/` layer first to understand data flow
3. Make changes in the correct layer (don't put business logic in components)

### When debugging:
1. Check if the feature is backend-wired (Section 6)
2. For API issues: check `apiClient.ts` → router → service → model
3. For state issues: check the feature's store/hooks → what triggers re-renders
4. For type mismatches: compare `shared/types/` with `backend/schemas/`

### Key files to always check:
- `backend/main.py` — all mounted routers
- `frontend/src/App.tsx` — all routes, top-level state orchestration
- `frontend/src/shared/types/` — all shared interfaces
- `frontend/src/shared/services/apiClient.ts` — how API calls are made
- `backend/core/auth.py` — how auth middleware works
