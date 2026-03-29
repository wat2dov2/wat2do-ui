# wat2do-v2

Event discovery and management platform for college students and club communities.

## Tech Stack

- **Frontend:** React 18 + TypeScript + Vite + Tailwind CSS (port 5173)
- **Backend:** Python FastAPI + Uvicorn (port 8000)
- **Database:** Supabase (PostgreSQL, SDK-only — no SQLAlchemy)
- **Design:** Corkboard aesthetic — pastel palette, serif headlines, soft shadows

## Project Structure

```
frontend/src/
  features/     # Vertical feature slices (auth, events, clubs, admin, etc.)
  shared/       # Reusable components, hooks, services, types, utils
  app/          # Layout, routes, top-level hooks
  contexts/     # React contexts (AppContext, NavigationContext)

backend/
  routers/      # API route handlers
  services/     # Business logic
  schemas/      # Pydantic models
  models/       # Database models
  core/         # Config, database, auth, logging

design-system/  # Standalone component library (zero external UI deps)
```

## Dev Commands

```bash
# Frontend
cd frontend && npm run dev          # Start dev server
npm run build                       # Production build
npm run check                       # Lint + type-check
npx playwright test                 # E2E tests

# Backend
cd backend && .venv/bin/python -m uvicorn main:app --reload

# Docker
docker-compose up                   # Full stack
```

## Conventions

- Frontend path alias: `@/*` maps to `./src/*`
- API client: custom fetch wrapper in `shared/services/apiClient.ts`
- Auth: Supabase JWT tokens in localStorage, Bearer token injection
- Backend routes: auth, users, events, clubs, uploads, qr
- Backend tests: pytest + pytest-asyncio in `backend/tests/`
- Frontend tests: Playwright E2E in `frontend/e2e/`
- UI components: Radix UI primitives + custom components in `shared/ui/`
- Backend auth-only routes use `_=Depends(get_current_user)` (underscore convention)
- Backend services are sync (not async) — Supabase SDK is sync
- Frontend: no `any` types — use `unknown` or specific interfaces
- ESLint: fetch-on-mount `setLoading` patterns use disable comments for `set-state-in-effect`
