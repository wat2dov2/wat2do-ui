/**
 * useNotifications Hook
 * Manages notification preferences state and operations
 */

import { useState, useEffect, useRef } from "react";
import {
  loadNotificationPreferences,
  saveNotificationPreferences,
  type NotificationPreferences,
} from "@/features/settings/api/settings.api";

export function useNotifications() {
  const [preferences, setPreferences] = useState<NotificationPreferences>(() => {
    return loadNotificationPreferences();
  });
  const isInitialMount = useRef(true);

  // Persist notification preferences (skip initial mount)
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
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
