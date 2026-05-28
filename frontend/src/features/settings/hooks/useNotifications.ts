/**
 * useNotifications Hook
 * Manages notification preferences state and operations
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchNotificationPreferences,
  getDefaultNotificationPreferences,
  saveNotificationPreference,
  type NotificationPreferences,
} from "@/features/settings/api/notificationPreferences.api";

export function useNotifications() {
  const [preferences, setPreferences] = useState<NotificationPreferences>(() => {
    return getDefaultNotificationPreferences();
  });
  const preferencesRef = useRef(preferences);

  const applyPreferences = useCallback((next: NotificationPreferences) => {
    preferencesRef.current = next;
    setPreferences(next);
  }, []);

  useEffect(() => {
    let isMounted = true;

    fetchNotificationPreferences()
      .then((next) => {
        if (isMounted) {
          applyPreferences(next);
        }
      })
      .catch((err) => {
        console.error("Failed to load notification preferences:", err);
      });

    return () => {
      isMounted = false;
    };
  }, [applyPreferences]);

  const updatePreference = useCallback(
    (key: keyof NotificationPreferences, value: boolean) => {
      const previousValue = preferencesRef.current[key];
      applyPreferences({ ...preferencesRef.current, [key]: value });

      saveNotificationPreference(key, value).catch((err) => {
        console.error("Failed to save notification preference:", err);
        if (preferencesRef.current[key] === value) {
          applyPreferences({ ...preferencesRef.current, [key]: previousValue });
        }
      });
    },
    [applyPreferences]
  );

  return {
    preferences,
    updatePreference,
  };
}
