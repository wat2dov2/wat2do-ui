/**
 * User Repository
 * Internal data layer for auth feature
 * Handles user data persistence (localStorage + API tokens)
 */

import { StorageService } from "@/shared/services/storageService";
import {
  getAccessToken,
  getRefreshToken,
  setTokens as setApiTokens,
  clearTokens as clearApiTokens,
  hasTokens as hasApiTokens,
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

// --- Tokens (delegated to apiClient) ---

export { getAccessToken, getRefreshToken, hasApiTokens as hasTokens };

export function saveTokens(accessToken: string, refreshToken: string): void {
  setApiTokens(accessToken, refreshToken);
}

export function clearTokens(): void {
  clearApiTokens();
}

// --- Full clear on logout ---

export function clearAllAuthData(): void {
  saveUserEmail(null);
  clearUserProfile();
  clearApiTokens();
}
