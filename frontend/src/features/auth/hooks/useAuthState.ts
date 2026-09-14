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
  AUTH_STATE_REFRESH_EVENT,
  type UserClubSummary,
} from "@/features/auth/api/userRepository";
import { ROLE_ADMIN } from "@/shared/constants/roles";

export interface AuthState {
  userId: string | null;
  userEmail: string | null;
  /** Cached ``users.full_name``; null when unset or signed out. */
  userFullName: string | null;
  /** Cached ``users.avatar_url``; null when unset or signed out. */
  userAvatarUrl: string | null;
  school: string | null;
  /** Mirrors `isAuthenticated()`: a signed-in session is cached. */
  isAuthenticated: boolean;
  /** Same as `isAuthenticated`; UI gates treat a valid session as "profile ready". */
  profileCompleted: boolean;
  isAdmin: boolean;
  hasClub: boolean;
  clubs: UserClubSummary[];
  clubId: number | null;
  clubName: string | null;
  payoutEmail: string | null;
  promoterTosAcceptedAt: string | null;
  promoterTosVersion: string | null;
  /** Role from the cached profile; defaults to `"user"`. */
  role: "user" | "admin";
}

const SERVER_AUTH_STATE: AuthState = Object.freeze({
  userId: null,
  userEmail: null,
  userFullName: null,
  userAvatarUrl: null,
  school: null,
  isAuthenticated: false,
  profileCompleted: false,
  isAdmin: false,
  hasClub: false,
  clubs: [],
  clubId: null,
  clubName: null,
  payoutEmail: null,
  promoterTosAcceptedAt: null,
  promoterTosVersion: null,
  role: "user",
});

/**
 * Live snapshot from the auth caches.
 *
 * Signed-in means "a session is cached", not "an access token is in memory".
 * The token lives in memory only, so it is absent on every page load until the
 * `/auth/refresh` round trip lands - a whole network hop after first paint.
 * Keying this on the token therefore rendered every page signed-out first and
 * signed-in a moment later, which is the layout jump users see on club
 * and event pages: header actions swap, membership controls appear, the page
 * reflows around them.
 *
 * The cached email survives reloads and is cleared by `clearAllAuthData()`, so
 * it is the durable fact about the session. Restoring optimistically from it
 * makes the first paint match the settled page. If the refresh token has since
 * expired, `initializeAuth` clears the cache and the UI corrects itself - a
 * rare correction rather than one on every single load. Requests are unaffected
 * either way: `apiClient` refreshes and retries a 401 on its own.
 *
 * `profileCompleted` mirrors `isAuthenticated`. Preference fields from
 * onboarding are optional, so UI gates (LogOut, save-event, saved-filter
 * visibility) key off session validity, not filled preferences.
 */
function computeSnapshot(): AuthState {
  const email = loadUserEmail();
  const profile = loadUserProfile();
  const authed = email !== null;
  const profileCompleted = authed;
  const role = profile?.role ?? "user";
  const clubs = authed ? profile?.clubs ?? [] : [];
  return Object.freeze({
    userId: authed ? profile?.id ?? null : null,
    userEmail: email,
    userFullName: authed ? profile?.fullName ?? null : null,
    userAvatarUrl: authed ? profile?.avatarUrl ?? null : null,
    school: authed ? profile?.school || null : null,
    isAuthenticated: authed,
    profileCompleted,
    isAdmin: authed && role === ROLE_ADMIN,
    hasClub: authed && (profile?.hasClub ?? false),
    clubs,
    clubId: authed ? profile?.clubId ?? null : null,
    clubName: authed ? profile?.clubName ?? null : null,
    payoutEmail: authed ? profile?.payoutEmail ?? null : null,
    promoterTosAcceptedAt: authed ? profile?.promoterTosAcceptedAt ?? null : null,
    promoterTosVersion: authed ? profile?.promoterTosVersion ?? null : null,
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
// (e.g. during initializeAuth() in client-providers.tsx, which awaits the
// /auth/refresh round-trip and saveUserProfile() before React mounts) still
// invalidate the cached snapshot. Without this, a profile refreshed between
// module load and mount would be read from a stale snapshot.
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
  return useSyncExternalStore(subscribe, getSnapshot, () => SERVER_AUTH_STATE);
}

/** Primitive selector - re-renders only when the email changes. */
export function useUserEmail(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => getSnapshot().userEmail,
    () => SERVER_AUTH_STATE.userEmail,
  );
}

/** Primitive selector - re-renders only when `profileCompleted` changes. */
export function useProfileCompleted(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => getSnapshot().profileCompleted,
    () => SERVER_AUTH_STATE.profileCompleted,
  );
}
