/**
 * User Repository
 * Internal data layer for auth feature
 * Handles user data persistence
 */

import { StorageService } from "@/shared/services/storageService";

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

/**
 * Load user email from localStorage
 */
export function loadUserEmail(): string | null {
  const email = StorageService.getItem<string | null>(
    STORAGE_KEYS.USER_EMAIL,
    null
  );
  return email;
}

/**
 * Save user email to localStorage
 */
export function saveUserEmail(email: string | null): void {
  if (email) {
    StorageService.setItem(STORAGE_KEYS.USER_EMAIL, email);
  } else {
    StorageService.removeItem(STORAGE_KEYS.USER_EMAIL);
  }
}

/**
 * Load user profile from localStorage
 */
export function loadUserProfile(): UserProfile | null {
  return StorageService.getItem<UserProfile | null>(
    STORAGE_KEYS.USER_PROFILE,
    null
  );
}

/**
 * Save user profile to localStorage
 */
export function saveUserProfile(profile: UserProfile): void {
  StorageService.setItem(STORAGE_KEYS.USER_PROFILE, profile);
}
