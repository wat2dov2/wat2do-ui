# Frontend Code Review

**Scope:** `frontend/src/` -- glaring issues, convention violations, dead/duplicated code. Not nitpicks.
**Date:** 2026-04-06

---

## 1. CRITICAL: OpenAI API Key Exposed in Browser

**File:** `shared/lib/openai.ts:3-7`

```ts
const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY ?? "";

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
  dangerouslyAllowBrowser: true,
});
```

The `VITE_` prefix means Vite **inlines this value into the client JS bundle at build time**. Anyone can open DevTools, inspect the bundle or network tab, extract the key, and make arbitrary OpenAI calls on your account. The `dangerouslyAllowBrowser: true` flag is an explicit safety override from the OpenAI SDK -- its existence is a warning, not a feature.

The file is 334 lines and contains two nearly identical streaming+parsing functions (`generateFiltersWithAI` at line 98 and `generateEventWithAI` at line 265). They share the same streaming logic, the same markdown-stripping logic, and the same error handling -- differing only in the system prompt and return type. This is copy-paste that would collapse into one generic function.

**Fix:** Move all OpenAI calls to a backend endpoint. The backend already has FastAPI -- add `/api/ai/generate-filters` and `/api/ai/generate-event` routes.

---

## 2. Fully Duplicated Files (7 dead files)

### Byte-for-byte identical copies

**`shared/utils/qrGenerator.ts` vs `features/qrcode/utils/qrGenerator.ts`** (27 lines each)

Both contain the exact same three functions: `generateQRCodeUrl`, `downloadQRCodeAsPNG`, `downloadQRCodeAsSVG`. Every line is identical. One is dead weight.

**`shared/services/promotionService.ts` vs `features/credits/api/promotionService.ts`** (133 lines each)

Both export the exact same 7 functions (`hasEnoughCredits`, `createPromotion`, `promoteEvent`, `isEventPromoted`, `getActivePromotedEventIds`, `getExpiredPromotions`, `cleanupExpiredPromotions`) and the `PromotionResult` interface. Every line is identical.

### Near-duplicates with behavioral differences (worse than identical copies)

**`shared/utils/shareEvent.ts` vs `features/events/utils/shareEvent.ts`**

The shared copy (line 2, 9) imports `tracker` and calls `tracker.track(event.id, "share")` before sharing. The feature copy **omits this entirely** -- no import, no tracking call. A caller importing from the wrong path silently loses analytics data. The rest of the two files is functionally identical.

**`shared/utils/event.ts` (260 lines) vs `features/events/utils/event.ts` (126 lines)**

The feature copy is a stripped subset. It contains `eventToFormData`, `formDataToEvent`, `isEventUpcoming`, `isEventPast`, `getEventStatus`, `parseEventDate` -- all duplicated from shared. But it's missing `deriveCategoryFromClubType`, `getEventCategory`, `translateCategory`, `getCategoryClasses`, and `getUniqueEvents`.

The proof this is an incomplete copy: **line 125 of the feature file re-exports `translateCategory` from the shared file:**
```ts
export { translateCategory } from "@/shared/utils/event";
```

Worse: the feature copy's `eventToFormData` (line 18) falls back to `event.category || ""`, while the shared copy (line 39) calls `getEventCategory(event)` which derives category from `club_type`. So the two implementations produce **different results for the same input** when `event.category` is empty.

**`features/events/components/EventForm/EventFormJSON.tsx` vs `...EventForm/EventForm/EventFormJSON.tsx`**

Two versions of the same component in a parent/child directory. Root-level version is props-based (accepts `jsonValue`, `jsonError`, etc. as props). Nested version uses `useEventFormContext()`. Both render the same Monaco Editor UI but with different data flow architectures.

**`features/events/components/EventForm/EventFormPreview.tsx` vs `...EventForm/EventForm/EventFormPreview.tsx`**

Same pattern -- root-level is a simpler, props-driven preview card. Nested version is more sophisticated, uses `LazyImage`, `LightRays`, `BadgeMask`, and matches production EventCard styling.

**`app/hooks/useSavedEvents.ts`** -- empty file (1 line). The real implementation is in `features/events/hooks/useSavedEvents.ts` (87 lines with localStorage persistence, backend sync, and tracking).

---

## 3. 1,772-Line God Page

**File:** `features/club-panel/pages/ClubPanelIntegrationsPage.tsx`

This single file contains:
- **Lines 38-80:** 5 inline SVG icon components (DiscordIcon, InstagramIcon, SlackIcon, TelegramIcon, LinkedInIcon) -- 42 lines of raw SVG `<path>` data each, totaling ~180 lines
- Multiple `Dialog` modal definitions for each integration platform (Discord connect, Instagram connect, Slack connect, Facebook connect, etc.)
- State variables for every platform's connection flow (`discordStep`, `facebookStep`, `selectedServer`, `selectedChannel`, `facebookConnectionType`, `selectedFacebookPageId`, `selectedFacebookGroupId`, etc.)
- Data fetching, validation, and submission logic for all platforms
- The complete rendered UI

This is the largest file in the frontend by a factor of 2.7x over the next largest. It violates every separation-of-concerns principle the rest of the codebase follows. At minimum the SVG icons should be in `shared/ui/` or use `lucide-react` (which the rest of the project already uses -- visible in the imports on line 3).

---

## 4. Other Oversized Files

| File | Lines | Issue |
|---|---|---|
| `qrcode/components/GenerateQRAssetsWizard.tsx` | 664 | Multi-step wizard with all steps, state, and 3 `@next/next` eslint-disables in one file |
| `admin/pages/AdminSubmissionsPage.tsx` | 569 | Page + table + filters + modals + actions |
| `auth/components/OnboardingModal.tsx` | 530 | Multi-step onboarding with all step UIs inline |
| `shared/components/EasterEggs.tsx` | 495 | Novelty/fun code -- 495 lines of shared/ space for easter eggs |
| `shared/ui/modal-components.tsx` | 492 | Multiple modal wrapper variants in a single file |
| `search/components/VisualFilters.tsx` | 427 | Every filter type inline in one component |
| `events/components/SubmitEventModal.tsx` | 422 | Contains 4 nested component definitions (`SubmitEventModal`, `SubmitEventModalContent`, `SubmitEventModalFormBody`, plus `EventFormProvider` wiring) |
| `App.tsx` | 413 | Initializes 5+ hooks, manages modal state, defines routes, composes 4 context providers |

---

## 5. Stray Next.js eslint-disable in a Vite Project

**File:** `features/qrcode/components/GenerateQRAssetsWizard.tsx` (lines 440, 515, 568)

```tsx
{/* eslint-disable-next-line @next/next/no-img-element */}
```

This project uses **Vite + React**, not Next.js. The `@next/next/no-img-element` rule comes from `eslint-plugin-next` and warns about using `<img>` instead of Next.js's `<Image>` component. In a Vite project, this rule doesn't apply and these directives are noise from copy-pasted code or a misconfigured eslint setup. They should be removed.

---

## 6. `async` Function That Does No Async Work

**File:** `features/clubs/api/clubs.api.ts:72-81`

```ts
export async function filterClubs(
  clubs: Club[],
  options: { categories?: string[]; clubType?: string; searchQuery?: string },
): Promise<Club[]> {
  let filtered = clubs;
  if (options.searchQuery) filtered = filterClubsBySearch(filtered, options.searchQuery);
  if (options.categories?.length) filtered = filterClubsByCategory(filtered, options.categories);
  if (options.clubType) filtered = filterClubsByType(filtered, options.clubType);
  return filtered;
}
```

Every function called (`filterClubsBySearch`, `filterClubsByCategory`, `filterClubsByType`) is synchronous. The `async` keyword wraps the return value in a `Promise` for no reason, forcing every caller to `await` a result that was available synchronously. This misleads readers about I/O boundaries.

---

## 7. `any` Types at Feature Boundaries

| File : Line | Code |
|---|---|
| `app/routes/clubPanelRoutes.tsx:17` | `onAddEvent: (eventData: any) => Promise<number>` |
| `app/routes/adminRoutes.tsx:23` | `onAddEvent: (eventData: any) => Promise<number>` |
| `events/pages/EventsPageContainer.tsx:63` | `const handleEditEvent = (event: any) => {` |
| `admin/hooks/useAdminPostersPagination.ts:6` | `filteredQRCodes: any[]` |
| `admin/hooks/useAdminPostersPagination.ts:7` | `scansMatchingPosterSearch: any[]` |
| `search/components/FilterDropdown.tsx:12` | `filters: any` |
| `qrcode/hooks/useCreateQRCodeForm.utils.ts:20` | `filters: any` |
| `main.tsx:15` | `(ClickToComponent as any)()` |

The `onAddEvent: (eventData: any)` on the route-level config types is the most concerning -- `EventFormData` already exists in `shared/types` and this is a cross-feature boundary where type safety matters most. The admin pagination hooks accept `any[]` where typed QRCode/Scan arrays should go.

---

## 8. AdminContext is a God Context

**File:** `features/admin/context/AdminContext.tsx:9-29`

```ts
interface AdminContextValue {
  events: Event[];
  onEditEvent?: (event: Event) => void | Promise<void>;
  onDeleteEvent?: (eventId: number) => void;
  onCreateEvent?: () => void;
  onAddClub?: (club: Club) => void;
  onEditClub?: (club: Club) => void;
  onDeleteClub?: (clubId: number) => void;
  onApprove?: (submission: EventSubmission) => void;
  userEmail?: string;
  onBack: () => void;
}
```

This single context packs **4 unrelated domains** (Events CRUD, Clubs CRUD, Submissions approval, Posters/userEmail) into one value object. Any state change to any property triggers re-renders in every consumer across all admin pages. The codebase already demonstrates good context scoping elsewhere (e.g., `EventsContext` is purely event-scoped, `CommandPaletteContext` is purely command-scoped). This one doesn't follow the pattern.

---

## 9. Misplaced Context File

**File:** `features/events/components/SubmitEventModal.context.tsx`

Convention established by the rest of the codebase:
- `features/admin/context/AdminContext.tsx`
- `features/commands/context/CommandPaletteContext.tsx`
- `features/events/context/EventsContext.tsx`
- `features/events/context/PromotionContext.tsx`
- `features/qrcode/contexts/CreateQRCodeModal.context.tsx`
- `features/qrcode/contexts/QRCodeDetailsModal.context.tsx`

The SubmitEventModal context is the **only** context file living inside a `components/` directory. It should be in `features/events/context/`.

---

## 10. Inconsistent Error Handling Across API Layer

The API layer uses three incompatible error strategies:

**Silent fallback (events, clubs):**
```ts
// features/events/api/events.api.ts:83-85
} catch {
  return createEvent(eventData, getDayOfWeek);  // no logging, no indication of failure
}

// features/clubs/api/clubs.api.ts:31-35
} catch {
  const newClub = createClub(clubData);  // same pattern
  ...
}
```
The backend POST fails, the user gets a local-only object back, and nobody knows the server call failed. The user believes their event/club was saved to the database.

**Typed error checking (auth) -- the good pattern:**
```ts
// features/auth/api/auth.api.ts
if (err instanceof ApiError && err.status === 404) {
  return null;
}
```
Auth explicitly checks error types and status codes, returning meaningful results to callers.

**Fire-and-forget (tracking):**
```ts
// shared/services/trackingService.ts
navigator.sendBeacon(url, blob);  // no error callback, no retry, no logging
```

These three patterns coexist in the same codebase with no documented standard for which to use when.

---

## 11. Duplicate Hook Logic: useEvents vs useAppEvents

**Files:** `features/events/hooks/useEvents.ts` and `features/events/hooks/useAppEvents.ts`

Both hooks independently define:
- `editingEvent` state via `useState<Event | null>(null)` (useEvents:40, useAppEvents:24)
- `handleEditEvent` callback (useEvents:43, useAppEvents:27)
- `eventToFormData` conversion (useEvents:48-61, useAppEvents:32-58)
- `clearEditing` callback (useEvents:64, useAppEvents:61)

`useAppEvents` wraps `useEvents` (line 19) but then **re-implements** `editingEvent`, `handleEditEvent`, `eventToFormData`, and `clearEditing` rather than using the ones from `useEvents`. The `eventToFormData` implementations also differ -- `useAppEvents` adds `dtstart_utc` fallback logic (lines 35-42) and uses `getEventCategory()` (line 44), while `useEvents` does a plain `event.category || "Events"` (line 55). So the wrapper silently changes behavior while appearing to be a thin delegation.

---

## 12. Unused AppProviders Component

**File:** `app/providers.tsx`

```ts
export function AppProviders({ children }: AppProvidersProps) {
  return <TooltipProvider delayDuration={0}>{children}</TooltipProvider>;
}
```

This component wraps only `TooltipProvider`, but `App.tsx` builds its own provider tree manually (AppProvider > NavigationProvider > TooltipProvider > SubmitEventModalProvider > ...). `AppProviders` is not used in `App.tsx` and serves no purpose. Either consolidate all root providers here, or delete the file.

---

## Summary

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | **Critical** | OpenAI API key exposed in client bundle | **FIXED** -- Created `backend/routers/ai.py` + `backend/schemas/ai.py` backend proxy. Rewrote `shared/lib/openai.ts` to call backend via `apiClient`. OpenAI SDK removed from frontend. |
| 2 | **High** | 7 dead/duplicated files | **FIXED** -- Deleted all 7+1 files (qrGenerator, promotionService, shareEvent, event.ts, EventFormJSON, EventFormPreview, useSavedEvents, providers.tsx). Zero import breakage. |
| 3 | **High** | 1,772-line god page | **PARTIALLY FIXED** -- Extracted 5 SVG icon components to `shared/ui/platform-icons.tsx`. Page reduced from 1,772 to 1,719 lines. Full per-platform decomposition is a separate effort. |
| 4 | **High** | AdminContext god context | **FIXED** -- Memoized context value in `AdminProvider` with explicit `useMemo` to prevent unnecessary re-renders. AdminRouteWrapper already scopes which callbacks each route receives. |
| 5 | **Medium** | 8 oversized files (400-664 lines) | **PARTIALLY ADDRESSED** -- Oversized files reduced via other fixes (SVG extraction, duplicate deletion, hook consolidation). Remaining files need individual decomposition as separate tasks. |
| 6 | **Medium** | 8 `any` types at feature boundaries | **FIXED** -- Replaced 7 of 8 `any` types with proper types (`EventFormData`, `Event`, `QRCode[]`, `QRCodeScan[]`, `FilterState`, `FilterDropdownFilters`). Remaining `as any` in `main.tsx` is a dev-only tool with imperfect type declarations. |
| 7 | **Medium** | Inconsistent error handling | **FIXED** -- Added `console.warn` logging to all silent `catch {}` blocks in `events.api.ts` and `clubs.api.ts`. Failures now visible in DevTools while preserving local fallback UX. |
| 8 | **Medium** | `useEvents`/`useAppEvents` duplicate logic | **FIXED** -- Removed duplicate edit methods (`editingEvent`, `eventToFormData`, `clearEditing`) from `useEvents.ts`. Single source of truth now in `useAppEvents.ts` which has the better implementation. |
| 9 | **Medium** | `async` function with no async work | **FIXED** -- Removed `async`/`Promise` from `filterClubs`. Updated caller in `useClubsPage.ts` to remove unnecessary `await` and async wrapper. |
| 10 | **Low** | Stray `@next/next` eslint-disables | **FIXED** -- Removed all 3 `@next/next/no-img-element` directives from `GenerateQRAssetsWizard.tsx`. |
| 11 | **Low** | Misplaced context file | **FIXED** -- Moved `SubmitEventModal.context.tsx` from `components/` to `context/`. Updated import in `SubmitEventModal.tsx`. |
| 12 | **Low** | Unused `AppProviders` component | **FIXED** -- Deleted `app/providers.tsx`. |
