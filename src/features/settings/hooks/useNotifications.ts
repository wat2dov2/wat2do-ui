/**
 * useNotifications Hook
 * Manages notification preferences state and operations
 */

import { useState, useEffect } from "react";
import {
  loadNotificationPreferences,
  saveNotificationPreferences,
  type NotificationPreferences,
} from "@/features/settings/api/settings.api";

export function useNotifications() {
  const [preferences, setPreferences] = useState<NotificationPreferences>(() => {
    return loadNotificationPreferences();
  });

  // Persist notification preferences
  useEffect(() => {
    saveNotificationPreferences(preferences);
  }, [preferences]);

  const updatePreference = (
    key: keyof NotificationPreferences,
    value: boolean
  ) => {
    setPreferences((prev) => ({ ...prev, [key]: value }));
  };

  return {
    preferences,
    updatePreference,
  };
}
