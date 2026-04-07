/**
 * Settings API
 * Handles all settings-related data operations
 * 
 * This is the public API for the settings feature.
 * It provides clean interfaces for managing user preferences.
 */

import { StorageService } from "@/shared/services/storageService";
import { getUserProfile, updateUserProfile, type UserProfile } from "@/features/auth";
import type { ViewMode, FilterViewMode } from "@/shared/types";

// Re-export UserProfile for feature use
export type { UserProfile };

// Storage keys
const STORAGE_KEYS = {
  NOTIFICATION_PREFS: "notificationPreferences",
  PRIVACY_PREFS: "privacyPreferences",
  VIEW_MODE: "viewMode",
  FILTER_VIEW_MODE: "filterViewMode",
} as const;

// Types
export interface NotificationPreferences {
  emailNotifications: boolean;
  eventReminders: boolean;
  newEventAlerts: boolean;
}

export interface PrivacyPreferences {
  profileVisibility: "public" | "private";
  dataSharing: boolean;
}

export interface AppearancePreferences {
  viewMode: ViewMode;
  filterViewMode: FilterViewMode;
}

// Default values
const DEFAULT_NOTIFICATION_PREFS: NotificationPreferences = {
  emailNotifications: true,
  eventReminders: true,
  newEventAlerts: true,
};

const DEFAULT_PRIVACY_PREFS: PrivacyPreferences = {
  profileVisibility: "public",
  dataSharing: true,
};

/**
 * Notification Preferences API
 */
export function loadNotificationPreferences(): NotificationPreferences {
  const saved = StorageService.getItem<string | null>(
    STORAGE_KEYS.NOTIFICATION_PREFS,
    null
  );
  return saved
    ? (JSON.parse(saved) as NotificationPreferences)
    : DEFAULT_NOTIFICATION_PREFS;
}

export function saveNotificationPreferences(prefs: NotificationPreferences): void {
  StorageService.setItem(STORAGE_KEYS.NOTIFICATION_PREFS, JSON.stringify(prefs));
}

/**
 * Privacy Preferences API
 */
export function loadPrivacyPreferences(): PrivacyPreferences {
  const saved = StorageService.getItem<string | null>(
    STORAGE_KEYS.PRIVACY_PREFS,
    null
  );
  return saved
    ? (JSON.parse(saved) as PrivacyPreferences)
    : DEFAULT_PRIVACY_PREFS;
}

export function savePrivacyPreferences(prefs: PrivacyPreferences): void {
  StorageService.setItem(STORAGE_KEYS.PRIVACY_PREFS, JSON.stringify(prefs));
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

/**
 * Appearance Preferences API
 */
export function loadAppearancePreferences(): AppearancePreferences | null {
  const viewMode = StorageService.getItem<ViewMode | null>(
    STORAGE_KEYS.VIEW_MODE,
    null
  );
  const filterViewMode = StorageService.getItem<FilterViewMode | null>(
    STORAGE_KEYS.FILTER_VIEW_MODE,
    null
  );
  
  if (viewMode === null && filterViewMode === null) {
    return null;
  }
  
  return {
    viewMode: viewMode || "grid",
    filterViewMode: filterViewMode || "visual",
  };
}

export function saveViewMode(viewMode: ViewMode): void {
  StorageService.setItem(STORAGE_KEYS.VIEW_MODE, viewMode);
}

export function saveFilterViewMode(filterViewMode: FilterViewMode): void {
  StorageService.setItem(STORAGE_KEYS.FILTER_VIEW_MODE, filterViewMode);
}

/**
 * Theme & Language — re-exported from shared (canonical home: shared/services/preferencesStorage.ts)
 */
export { loadTheme, saveTheme, loadLanguage, saveLanguage, type SupportedLanguage } from "@/shared/services/preferencesStorage";
