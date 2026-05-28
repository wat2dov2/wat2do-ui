/**
 * usePrivacy Hook
 * Manages privacy preferences state and operations
 */

import { useState } from "react";
import {
  loadPrivacyPreferences,
  savePrivacyPreferences,
  type PrivacyPreferences,
} from "@/features/settings/api/settings.api";

export function usePrivacy() {
  const [preferences, setPreferences] = useState<PrivacyPreferences>(() => {
    return loadPrivacyPreferences();
  });

  const updatePreference = (
    key: keyof PrivacyPreferences,
    value: string | boolean
  ) => {
    setPreferences((prev) => {
      const next = { ...prev, [key]: value };
      savePrivacyPreferences(next);
      return next;
    });
  };

  return {
    preferences,
    updatePreference,
  };
}
