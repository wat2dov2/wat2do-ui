/**
 * User Repository
 * Internal data layer for auth feature
 * Handles user data persistence (localStorage for profile cache, in-memory for tokens)
 */

import { StorageService } from "@/shared/services/storageService";
import { STORAGE_KEYS } from "@/shared/constants/storageKeys";
import {
  setAccessToken,
  clearAccessToken,
  hasAccessToken,
} from "@/shared/services/apiClient";

/** Same-tab notification event for cached auth/profile updates. */
export const AUTH_STATE_REFRESH_EVENT = "auth-state-refresh";

function notifyAuthStateChanged(): void {
  if (typeof window !== "undefined") {
    try {
      window.dispatchEvent(new Event(AUTH_STATE_REFRESH_EVENT));
    } catch (err) {
      console.error("Failed to dispatch auth-state-refresh event:", err);
    }
  }
}

export interface UserProfile {
  /** Supabase user UUID (from backend `users.id`). Null for legacy cached profiles. */
  id?: string;
  faculty: string;
  interests: string[];
  isFirstYear: boolean;
  school: string;
  /** Mirrors the backend ``role`` column ("user" | "admin"). Defaults to "user". */
  role: "user" | "admin";
  /** True when the user owns at least one club. */
  hasClub: boolean;
}

// ── In-memory caches ────────────────────────────────────────────────
// Avoid re-parsing localStorage JSON on every read (ProtectedRoute,
// readAuthFlags, getUserId on every EventsPage render, etc.). `undefined`
// means "not loaded" — the next read will populate from localStorage.
// Writes invalidate immediately; cross-tab "storage" events invalidate
// the cache lazily so the next reader sees the new value.

let _cachedEmail: string | null | undefined;
let _cachedProfile: UserProfile | null | undefined;

function invalidateCaches(): void {
  _cachedEmail = undefined;
  _cachedProfile = undefined;
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEYS.USER_EMAIL || e.key === STORAGE_KEYS.USER_PROFILE || e.key === null) {
      invalidateCaches();
    }
  });
}

// --- Email ---

export function loadUserEmail(): string | null {
  if (_cachedEmail !== undefined) return _cachedEmail;
  _cachedEmail = StorageService.getItem<string | null>(STORAGE_KEYS.USER_EMAIL, null);
  return _cachedEmail;
}

export function saveUserEmail(email: string | null, notify = true): void {
  if (email) {
    StorageService.setItem(STORAGE_KEYS.USER_EMAIL, email);
  } else {
    StorageService.removeItem(STORAGE_KEYS.USER_EMAIL);
  }
  _cachedEmail = email;
  if (notify) notifyAuthStateChanged();
}

// --- Profile ---

export function loadUserProfile(): UserProfile | null {
  if (_cachedProfile !== undefined) return _cachedProfile;
  _cachedProfile = StorageService.getItem<UserProfile | null>(STORAGE_KEYS.USER_PROFILE, null);
  return _cachedProfile;
}

export function saveUserProfile(profile: UserProfile): void {
  StorageService.setItem(STORAGE_KEYS.USER_PROFILE, profile);
  _cachedProfile = profile;
  notifyAuthStateChanged();
}

function clearUserProfile(notify = true): void {
  StorageService.removeItem(STORAGE_KEYS.USER_PROFILE);
  _cachedProfile = null;
  if (notify) notifyAuthStateChanged();
}

// --- Tokens (in-memory via apiClient) ---

export { hasAccessToken };

export function saveAccessToken(token: string): void {
  setAccessToken(token);
}

// --- Full clear on logout ---

export function clearAllAuthData(): void {
  saveUserEmail(null, false);
  clearUserProfile(false);
  clearAccessToken();
  notifyAuthStateChanged();
}
