/**
 * Settings Feature Public API
 * 
 * This is the only file that should be imported from outside the feature.
 * It provides a clean, stable interface for the settings feature.
 */

// Pages
export { SettingsPage } from "./pages/SettingsPage";

// API
export { setDailyNewEventsEmailPreferenceAPI } from "./api/notificationPreferences.api";

// Types
export type {
  PrivacyPreferences,
  AppearancePreferences,
} from "./api/settings.api";
export type { NotificationPreferences } from "./api/notificationPreferences.api";
