# Frontend Architecture (React / `frontend/src`)

> **Scope:** this document governs the **frontend** codebase only
> (`frontend/src/**`). The backend uses a different, layered structure —
> see [`backend-architecture.md`](./backend-architecture.md). Do not apply
> the feature-sliced rules below to `backend/`.

This document explains how the Cursor hooks enforce scalable React architecture patterns.

## Overview

The hooks analyze every code edit and enforce 7 core architectural principles:

1. **Scale by structure, not features** - Organize by domain, not file type
2. **Control complexity with state boundaries** - Local state first, global state last
3. **Separate responsibilities cleanly** - UI, logic, data, state, orchestration
4. **Design APIs between features** - Internal contracts, not direct imports
5. **Feature flags & modular loading** - Isolated, lazy-loadable features
6. **Test the seams, not everything** - Test boundaries and contracts
7. **Enforce architecture with rules** - Dependency direction and boundaries

## How It Works

### `analyze-edits.ts`

Runs after every file edit and checks for:

#### 1. Structure Violations
- **Detects**: Files in old structure (`components/`, `hooks/`, `utils/`, `services/`)
- **Suggests**: Move to feature-based structure (`src/features/[feature-name]/`)
- **Example**:
  ```
  ❌ src/components/EventCard.tsx
  ✅ src/features/events/components/EventCard.tsx
  ```

#### 2. State Boundary Violations
- **Detects**: Excessive global state usage, mixing local/global state
- **Rules**:
  - Components should use `useState` for UI state
  - Complex local logic → `useReducer`
  - Global state only for: auth, user, permissions, app config, cross-feature data
- **Example**:
  ```
  ⚠️ Component uses 5 useState + 2 global hooks
  → Consider if all state needs to be global
  ```

#### 3. Separation of Concerns Violations
- **Detects**: Components doing too much (UI + data fetching + business logic)
- **Rules**:
  - UI components → dumb, visual only
  - Logic hooks → smart, business logic
  - Data layer → APIs, queries
  - State layer → stores
  - Orchestration → pages/controllers
- **Example**:
  ```
  🔀 Component fetches data, manages state, and renders UI
  → Extract data fetching to hook, state to store, keep UI in component
  ```

#### 4. Feature Isolation Violations
- **Detects**: Direct imports between features
- **Rules**: Features should communicate through APIs/services, not direct imports
- **Example**:
  ```
  🔒 features/auth imports from features/events
  → Create shared API or use dependency injection
  ```

#### 5. API Design Violations
- **Detects**: Missing or poorly designed feature APIs
- **Rules**: Features should expose clean interfaces via `feature.api.ts` and `index.ts`
- **Example**:
  ```
  📡 Feature exports scattered across files
  → Create feature.api.ts for external interface, index.ts for exports
  ```

### `generate-followup.ts`

Generates followup messages after code generation with:
- Prioritized architecture violations
- Specific suggestions for each violation
- Architecture principles reminders
- Scalability checklist

## Expected Feature Structure

```
src/
├── features/
│   ├── auth/
│   │   ├── pages/
│   │   │   └── LoginPage.tsx
│   │   ├── components/
│   │   │   └── LoginForm.tsx
│   │   ├── hooks/
│   │   │   └── useAuth.ts
│   │   ├── auth.api.ts      # External interface
│   │   ├── auth.store.ts    # State management
│   │   └── index.ts          # Feature exports
│   │
│   ├── events/
│   │   ├── pages/
│   │   │   └── EventsPage.tsx
│   │   ├── components/
│   │   │   ├── EventCard.tsx
│   │   │   └── EventList.tsx
│   │   ├── hooks/
│   │   │   └── useEvents.ts
│   │   ├── events.api.ts
│   │   ├── events.store.ts
│   │   └── index.ts
│   │
│   └── ...
│
├── shared/
│   ├── generated/       # Auto-generated from backend OpenAPI spec (npm run generate-types)
│   │   ├── openapi.json   # Exported OpenAPI schema
│   │   ├── api-types.ts   # Generated types (do not edit)
│   │   └── index.ts       # Convenience re-exports (ApiEventResponse, etc.)
│   ├── ui/              # Reusable UI components
│   ├── hooks/           # Shared hooks
│   ├── utils/           # Shared utilities
│   └── api/             # Shared API utilities
│
└── app/
    ├── App.tsx
    ├── router.tsx
    └── providers.tsx
```

## Architecture Rules

### ✅ DO

1. **Organize by feature/domain**
   ```
   src/features/events/components/EventCard.tsx
   ```

2. **Use local state first**
   ```tsx
   const [isOpen, setIsOpen] = useState(false); // ✅ UI state
   ```

3. **Separate concerns**
   ```tsx
   // Component (UI only)
   function EventCard({ event }: Props) { ... }
   
   // Hook (logic)
   function useEventActions() { ... }
   
   // API (data)
   export async function fetchEvent(id: string) { ... }
   ```

4. **Design feature APIs**
   ```ts
   // events.api.ts
   export function getEvent(id: string) { ... }
   export function createEvent(data: EventData) { ... }
   ```

5. **Isolate features**
   ```ts
   // ✅ Features communicate through APIs
   import { getEvent } from '@/features/events';
   ```

6. **Use generated types for backend response shapes**
   ```ts
   // ✅ Import from generated types
   import type { ApiPromotionResponse } from "@/shared/generated";
   type PromotionResponse = ApiPromotionResponse;
   ```

7. **Always log errors in catch blocks**
   ```ts
   // ✅ Log before falling back
   fetchData()
     .then((data) => setData(data))
     .catch((err) => console.error("Failed to fetch data:", err));
   ```

### ❌ DON'T

1. **Organize by file type**
   ```
   src/components/EventCard.tsx  // ❌
   src/hooks/useEvents.ts        // ❌
   ```

2. **Use global state for everything**
   ```tsx
   // ❌ Component with only global state
   function EventCard() {
     const { events } = useAppEvents(); // Should receive via props
   }
   ```

3. **Mix concerns**
   ```tsx
   // ❌ Component doing everything
   function EventCard() {
     const [data, setData] = useState();
     useEffect(() => {
       fetch('/api/events').then(...); // Data fetching in component
     });
     // Complex business logic
     // UI rendering
   }
   ```

4. **Direct cross-feature imports**
   ```ts
   // ❌ Direct import
   import { EventCard } from '@/features/events/components';
   ```

5. **Scattered exports**
   ```ts
   // ❌ No clear API
   // Exports scattered across multiple files
   ```

6. **Hand-write backend response types**
   ```ts
   // ❌ Manually duplicating what the backend already defines
   interface SubmissionResponse {
     id: string;
     user_id: string;
     // ... drift happens here
   }
   ```

7. **Swallow errors silently**
   ```ts
   // ❌ Bug becomes invisible
   saveData().catch(() => {});
   ```

## Violation Severity

- **High**: Critical issues that prevent scaling (structure, isolation)
- **Medium**: Issues that create technical debt (state boundaries, separation)
- **Low**: Best practice improvements (API design)

## Integration

The hooks run automatically on every file edit. They:
1. Analyze the edited file
2. Check against all architectural rules
3. Generate suggestions
4. Save analysis to `.cursor/hooks/state/`
5. Generate followup messages with prioritized violations

## Customization

To adjust rules, edit:
- `.cursor/hooks/utils/architecture-analyzer.ts` - Core analysis logic
- `.cursor/hooks/analyze-edits.ts` - Analysis orchestration
- `.cursor/hooks/generate-followup.ts` - Message generation

## Mental Model

Think in systems, not components:
- **Features are products** - Self-contained, deletable
- **Components are views** - Dumb, visual
- **Hooks are controllers** - Smart, logic
- **Services are infrastructure** - Data, APIs
- **Stores are memory** - State management
- **Pages are orchestration** - Composition layer

## The Real Secret

**Scalability is about limiting freedom.**

Not flexibility. Not clever abstractions. Not frameworks.

**Constraints scale. Rules scale. Boundaries scale.**
