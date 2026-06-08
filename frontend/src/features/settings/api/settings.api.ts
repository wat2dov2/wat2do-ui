/**
 * Settings API
 * Handles all settings-related data operations
 *
 * This is the public API for the settings feature.
 * It provides clean interfaces for managing user preferences.
 */

import { StorageService } from "@/shared/services/storageService";
import { STORAGE_KEYS } from "@/shared/constants/storageKeys";
import { getUserProfile, updateUserProfile, type UserProfile } from "@/features/auth";

// Re-export UserProfile for feature use
export type { UserProfile };

// Types
export interface PrivacyPreferences {
  profileVisibility: "public" | "private";
  dataSharing: boolean;
}


// Default values
const DEFAULT_PRIVACY_PREFS: PrivacyPreferences = {
  profileVisibility: "public",
  dataSharing: true,
};

/**
 * Privacy Preferences API
 *
 * StorageService.setItem already JSON-stringifies; we pass the object directly.
 */
export function loadPrivacyPreferences(): PrivacyPreferences {
  return StorageService.getItem<PrivacyPreferences>(
    STORAGE_KEYS.PRIVACY_PREFS,
    DEFAULT_PRIVACY_PREFS
  );
}

export function savePrivacyPreferences(prefs: PrivacyPreferences): void {
  StorageService.setItem(STORAGE_KEYS.PRIVACY_PREFS, prefs);
}

/**
 * User Profile API
 */
export function loadProfile(): UserProfile | null {
  return getUserProfile();
}

export function saveProfile(profile: UserProfile): void {
  updateUserProfile(profile);
}

