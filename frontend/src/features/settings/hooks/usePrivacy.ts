/**
 * usePrivacy Hook
 * Manages privacy preferences state and operations
 */

import { useState, useEffect, useRef } from "react";
import {
  loadPrivacyPreferences,
  savePrivacyPreferences,
  type PrivacyPreferences,
} from "@/features/settings/api/settings.api";

export function usePrivacy() {
  const [preferences, setPreferences] = useState<PrivacyPreferences>(() => {
    return loadPrivacyPreferences();
  });
  const isInitialMount = useRef(true);

  // Persist privacy preferences (skip initial mount)
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
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
