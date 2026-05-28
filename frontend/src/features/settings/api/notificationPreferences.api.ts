import { api } from "@/shared/services/apiClient";
import type { components } from "@/shared/generated/api-types";

export interface NotificationPreferences {
  emailNotifications: boolean;
  eventReminders: boolean;
  newEventAlerts: boolean;
}

type ApiNotificationPreferenceUpdate =
  components["schemas"]["NotificationPreferenceUpdate"];
type ApiNotificationPreferencesBulkUpdate =
  components["schemas"]["NotificationPreferencesBulkUpdate"];
type ApiNotificationPreferencesListResponse =
  components["schemas"]["NotificationPreferencesListResponse"];
type NotificationPreferenceKey = keyof NotificationPreferences;

const DEFAULT_NOTIFICATION_PREFS: NotificationPreferences = {
  emailNotifications: true,
  eventReminders: true,
  newEventAlerts: true,
};

const NOTIFICATION_TYPE_BY_KEY: Record<
  NotificationPreferenceKey,
  ApiNotificationPreferenceUpdate["notification_type"]
> = {
  emailNotifications: "morning_digest",
  eventReminders: "event_change",
  newEventAlerts: "daily_new_events",
};

function mapNotificationPreferences(
  response: ApiNotificationPreferencesListResponse
): NotificationPreferences {
  const next = { ...DEFAULT_NOTIFICATION_PREFS };

  for (const [key, notificationType] of Object.entries(NOTIFICATION_TYPE_BY_KEY) as Array<
    [NotificationPreferenceKey, ApiNotificationPreferenceUpdate["notification_type"]]
  >) {
    const preference = response.preferences.find(
      (item) => item.notification_type === notificationType
    );
    if (preference) {
      next[key] = preference.enabled;
    }
  }

  return next;
}

export function getDefaultNotificationPreferences(): NotificationPreferences {
  return { ...DEFAULT_NOTIFICATION_PREFS };
}

export async function fetchNotificationPreferences(): Promise<NotificationPreferences> {
  const response = await api.get<ApiNotificationPreferencesListResponse>(
    "/notification-preferences"
  );
  return mapNotificationPreferences(response);
}

export async function saveNotificationPreference(
  key: NotificationPreferenceKey,
  enabled: boolean
): Promise<void> {
  const payload: ApiNotificationPreferencesBulkUpdate = {
    preferences: [
      {
        notification_type: NOTIFICATION_TYPE_BY_KEY[key],
        enabled,
      },
    ],
  };
  await api.patch("/notification-preferences", payload);
}

export function setDailyNewEventsEmailPreferenceAPI(enabled: boolean): Promise<void> {
  return saveNotificationPreference("newEventAlerts", enabled);
}
