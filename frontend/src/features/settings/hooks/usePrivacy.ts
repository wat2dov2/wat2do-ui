/**
 * usePrivacy Hook
 * Manages privacy preferences state and operations
 */

import { useState, useEffect } from "react";
import {
  loadPrivacyPreferences,
  savePrivacyPreferences,
  type PrivacyPreferences,
} from "@/features/settings/api/settings.api";

export function usePrivacy() {
  const [preferences, setPreferences] = useState<PrivacyPreferences>(() => {
    return loadPrivacyPreferences();
  });

  // Persist privacy preferences
  useEffect(() => {
    savePrivacyPreferences(preferences);
  }, [preferences]);

  const updatePreference = (
    key: keyof PrivacyPreferences,
    value: string | boolean
  ) => {
    setPreferences((prev) => ({ ...prev, [key]: value }));
  };

  return {
    preferences,
    updatePreference,
  };
}
