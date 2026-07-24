/**
 * Settings API
 * Handles all settings-related data operations
 *
 * This is the public API for the settings feature.
 * It provides clean interfaces for managing user preferences.
 */

import { getUserProfile, updateUserProfile, type UserProfile } from "@/features/auth";

// Re-export UserProfile for feature use
export type { UserProfile };

/**
 * User Profile API
 */
export function loadProfile(): UserProfile | null {
  return getUserProfile();
}

export function saveProfile(profile: UserProfile): void {
  updateUserProfile(profile);
}

