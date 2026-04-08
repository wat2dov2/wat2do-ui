/**
 * User Repository
 * Internal data layer for auth feature
 * Handles user data persistence (localStorage for profile cache, in-memory for tokens)
 */

import { StorageService } from "@/shared/services/storageService";
import { STORAGE_KEYS } from "@/shared/constants/storageKeys";
import {
  getAccessToken,
  setAccessToken,
  clearAccessToken,
  hasAccessToken,
} from "@/shared/services/apiClient";

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

// --- Email ---

export function loadUserEmail(): string | null {
  return StorageService.getItem<string | null>(STORAGE_KEYS.USER_EMAIL, null);
}

export function saveUserEmail(email: string | null): void {
  if (email) {
    StorageService.setItem(STORAGE_KEYS.USER_EMAIL, email);
  } else {
    StorageService.removeItem(STORAGE_KEYS.USER_EMAIL);
  }
}

// --- Profile ---

export function loadUserProfile(): UserProfile | null {
  return StorageService.getItem<UserProfile | null>(STORAGE_KEYS.USER_PROFILE, null);
}

export function saveUserProfile(profile: UserProfile): void {
  StorageService.setItem(STORAGE_KEYS.USER_PROFILE, profile);
}

export function clearUserProfile(): void {
  StorageService.removeItem(STORAGE_KEYS.USER_PROFILE);
}

// --- Tokens (in-memory via apiClient) ---

export { getAccessToken, hasAccessToken as hasTokens };

export function saveAccessToken(token: string): void {
  setAccessToken(token);
}

export function clearTokens(): void {
  clearAccessToken();
}

// --- Full clear on logout ---

export function clearAllAuthData(): void {
  saveUserEmail(null);
  clearUserProfile();
  clearAccessToken();
}
