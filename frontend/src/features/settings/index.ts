/**
 * Settings Feature Public API
 * 
 * This is the only file that should be imported from outside the feature.
 * It provides a clean, stable interface for the settings feature.
 */

// Pages
export { SettingsPage } from "./pages/SettingsPage";

// Types
export type {
  NotificationPreferences,
  PrivacyPreferences,
  AppearancePreferences,
} from "./api/settings.api";
