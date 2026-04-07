/**
 * User Repository
 * Internal data layer for auth feature
 * Handles user data persistence (localStorage for profile cache, in-memory for tokens)
 */

import { StorageService } from "@/shared/services/storageService";
import {
  getAccessToken,
  setAccessToken,
  clearAccessToken,
  hasAccessToken,
} from "@/shared/services/apiClient";

const STORAGE_KEYS = {
  USER_EMAIL: "userEmail",
  USER_PROFILE: "userProfile",
} as const;

export interface UserProfile {
  faculty: string;
  interests: string[];
  isFirstYear: boolean;
  school: string;
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
