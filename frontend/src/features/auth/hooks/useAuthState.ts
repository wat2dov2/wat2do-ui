/**
 * useAuthState
 * ------------
 * React binding over the auth module's localStorage-backed caches via
 * `useSyncExternalStore`, so each consumer re-renders only when the slice
 * it reads changes.
 *
 * Source of truth is `userRepository.ts`; this file subscribes to the
 * same-tab `AUTH_STATE_REFRESH_EVENT` and native cross-tab `storage` events,
 * then returns a cached frozen snapshot that invalidates when either fires.
 */
import { useSyncExternalStore } from "react";
import {
  loadUserEmail,
  loadUserProfile,
  hasAccessToken,
  AUTH_STATE_REFRESH_EVENT,
  type UserOrganizationSummary,
} from "@/features/auth/api/userRepository";
import { ROLE_ADMIN } from "@/shared/constants/roles";

export interface AuthState {
  userEmail: string | null;
  /** Cached ``users.full_name``; null when unset or signed out. */
  userFullName: string | null;
  /** Cached ``users.avatar_url``; null when unset or signed out. */
  userAvatarUrl: string | null;
  /** Mirrors `isAuthenticated()`: has access token AND cached email. */
  isAuthenticated: boolean;
  /** Same as `isAuthenticated`; UI gates treat a valid session as "profile ready". */
  profileCompleted: boolean;
  isAdmin: boolean;
  hasOrganization: boolean;
  clubs: UserOrganizationSummary[];
  organizationId: number | null;
  organizationName: string | null;
  /** Role from the cached profile; defaults to `"user"`. */
  role: "user" | "admin";
}

/**
 * Live snapshot from the auth caches.
 *
 * `profileCompleted` mirrors `isAuthenticated` (access token + cached email).
 * Preference fields from onboarding are optional, so UI gates (LogOut, save-event,
 * saved-filter visibility) key off session validity, not filled preferences.
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
    userFullName: authed ? profile?.fullName ?? null : null,
    userAvatarUrl: authed ? profile?.avatarUrl ?? null : null,
    isAuthenticated: authed,
    profileCompleted,
    isAdmin: authed && role === ROLE_ADMIN,
    hasOrganization: authed && (profile?.hasOrganization ?? false),
    clubs,
    organizationId: authed ? profile?.organizationId ?? null : null,
    organizationName: authed ? profile?.organizationName ?? null : null,
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
// (e.g. during initializeAuth() in client-providers.tsx, which awaits the /auth/refresh
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

/** Full auth snapshot - use only when a component reads ≥2 fields. */
export function useAuthState(): AuthState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Primitive selector - re-renders only when the email changes. */
export function useUserEmail(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => getSnapshot().userEmail,
    () => getSnapshot().userEmail,
  );
}

/** Primitive selector - re-renders only when `profileCompleted` changes. */
export function useProfileCompleted(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => getSnapshot().profileCompleted,
    () => getSnapshot().profileCompleted,
  );
}
