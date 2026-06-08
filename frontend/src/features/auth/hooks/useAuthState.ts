/**
 * useAuthState
 * ------------
 * React binding over the auth module's localStorage-backed caches. Replaces
 * the old `UserContext`/`UserProvider` fat-context with a narrow set of
 * `useSyncExternalStore` hooks so each consumer re-renders only when the
 * specific slice it reads changes.
 *
 * Source of truth is `userRepository.ts`; this file only subscribes to the
 * same-tab `AUTH_STATE_REFRESH_EVENT` and native cross-tab `storage` events,
 * then returns a cached frozen snapshot that invalidates when either fires.
 */
import { useSyncExternalStore } from "react";
import {
  loadUserEmail,
  loadUserProfile,
  hasAccessToken,
  AUTH_STATE_REFRESH_EVENT,
  type UserClubSummary,
} from "@/features/auth/api/userRepository";
import { ROLE_ADMIN } from "@/shared/constants/roles";

export interface AuthState {
  userEmail: string | null;
  /** Mirrors `isAuthenticated()`: has access token AND cached email. */
  isAuthenticated: boolean;
  profileCompleted: boolean;
  isAdmin: boolean;
  hasOrganization: boolean;
  clubs: UserClubSummary[];
  clubId: number | null;
  clubName: string | null;
  /** Mirrors `getUserRole()`. */
  role: "user" | "admin";
}

/**
 * Compute the live snapshot from the auth caches. Kept in sync with the
 * semantics of `isAuthenticated()` / `isProfileCompleted()` / `getUserRole()`
 * / `getUserHasClub()` in `auth.api.ts`.
 *
 * `profileCompleted` reflects "user has a valid authenticated session" — the
 * concept UI gates (LogOut button, save-event, saved-filter visibility) need.
 * It is not gated on having filled specific preference fields because
 * onboarding makes faculty/interests optional; gating on them left freshly
 * signed-up users appearing logged out on the home route.
 */
function computeSnapshot(): AuthState {
  const email = loadUserEmail();
  const profile = loadUserProfile();
  const authed = hasAccessToken() && email !== null;
  const profileCompleted = authed;
  const role = profile?.role ?? "user";
  const clubs = authed ? profile?.clubs ?? [] : [];
  return Object.freeze({
    userEmail: email,
    isAuthenticated: authed,
    profileCompleted,
    isAdmin: authed && role === ROLE_ADMIN,
    hasOrganization: authed && (profile?.hasOrganization ?? false),
    clubs,
    clubId: authed ? profile?.clubId ?? null : null,
    clubName: authed ? profile?.clubName ?? null : null,
    role,
  });
}

// Cached frozen snapshot. `useSyncExternalStore` requires `getSnapshot` to
// return a referentially stable value while the underlying state is
// unchanged, or React will detect an infinite loop. We invalidate on any
// auth event and recompute lazily on the next read.
let cachedSnapshot: AuthState = computeSnapshot();
let snapshotDirty = false;

function getSnapshot(): AuthState {
  if (snapshotDirty) {
    snapshotDirty = false;
    cachedSnapshot = computeSnapshot();
  }
  return cachedSnapshot;
}

function markDirty(): void {
  snapshotDirty = true;
}

// Module-level listeners so auth events fired BEFORE any component subscribes
// (e.g. during initializeAuth() in main.tsx, which awaits the /auth/refresh
// round-trip and saveUserProfile() before React mounts) still invalidate the
// cached snapshot. Without this, the first render reads the stale snapshot
// that was computed at module load time with no access token → UI flashes
// "signed-out" even though the session was successfully restored.
if (typeof window !== "undefined") {
  window.addEventListener("storage", markDirty);
  window.addEventListener(AUTH_STATE_REFRESH_EVENT, markDirty);
}

function subscribe(onStoreChange: () => void): () => void {
  const handler = () => {
    markDirty();
    onStoreChange();
  };
  window.addEventListener("storage", handler);
  window.addEventListener(AUTH_STATE_REFRESH_EVENT, handler);
  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener(AUTH_STATE_REFRESH_EVENT, handler);
  };
}

/** Full auth snapshot — use only when a component reads ≥2 fields. */
export function useAuthState(): AuthState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Primitive selector — re-renders only when the email changes. */
export function useUserEmail(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => getSnapshot().userEmail,
    () => getSnapshot().userEmail,
  );
}

/** Primitive selector — re-renders only when `profileCompleted` changes. */
export function useProfileCompleted(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => getSnapshot().profileCompleted,
    () => getSnapshot().profileCompleted,
  );
}

/** Primitive selector — re-renders only when admin status changes. */
export function useIsAdmin(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => getSnapshot().isAdmin,
    () => getSnapshot().isAdmin,
  );
}

/** Primitive selector — re-renders only when club ownership changes. */
export function useHasClub(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => getSnapshot().hasOrganization,
    () => getSnapshot().hasOrganization,
  );
}
