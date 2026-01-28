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
  DARK_MODE: "darkMode",
  THEME: "theme",
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
 * Theme/Dark Mode API
 */

/**
 * Load dark mode preference from localStorage
 */
export function loadDarkMode(): boolean | null {
  const saved = StorageService.getItem<string | null>(
    STORAGE_KEYS.DARK_MODE,
    null
  );
  if (saved === null) return null;
  try {
    return JSON.parse(saved) as boolean;
  } catch {
    return null;
  }
}

/**
 * Save dark mode preference to localStorage
 */
export function saveDarkMode(isDark: boolean): void {
  StorageService.setItem(STORAGE_KEYS.DARK_MODE, JSON.stringify(isDark));
}

/**
 * Load theme preference (for AnimatedThemeToggler compatibility)
 */
export function loadTheme(): "dark" | "light" | null {
  const saved = StorageService.getItem<string | null>(
    STORAGE_KEYS.THEME,
    null
  );
  return saved === "dark" || saved === "light" ? saved : null;
}

/**
 * Save theme preference (for AnimatedThemeToggler compatibility)
 */
export function saveTheme(theme: "dark" | "light"): void {
  StorageService.setItem(STORAGE_KEYS.THEME, theme);
}

/**
 * Language Preferences API
 */

const SUPPORTED_LANGUAGES = ['en', 'zh', 'es', 'ja', 'ko', 'fr'] as const;
export type SupportedLanguage = typeof SUPPORTED_LANGUAGES[number];

const LANGUAGE_STORAGE_KEY = "i18n-language";

/**
 * Load language preference from localStorage
 */
export function loadLanguage(): SupportedLanguage {
  const saved = StorageService.getItem<string | null>(LANGUAGE_STORAGE_KEY, null);
  if (saved && SUPPORTED_LANGUAGES.includes(saved as SupportedLanguage)) {
    return saved as SupportedLanguage;
  }
  return 'en';
}

/**
 * Save language preference to localStorage
 */
export function saveLanguage(language: SupportedLanguage): void {
  StorageService.setItem(LANGUAGE_STORAGE_KEY, language);
}
