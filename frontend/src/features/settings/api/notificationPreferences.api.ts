import { api } from "@/shared/services/apiClient";
import type { components } from "@/shared/generated/api-types";

export interface NotificationPreferences {
  morningEmail: boolean;
  eventReminder: boolean;
  eventChange: boolean;
}

type ApiNotificationPreferenceUpdate =
  components["schemas"]["NotificationPreferenceUpdate"];
type ApiNotificationPreferencesBulkUpdate =
  components["schemas"]["NotificationPreferencesBulkUpdate"];
type ApiNotificationPreferencesListResponse =
  components["schemas"]["NotificationPreferencesListResponse"];
export type NotificationPreferenceKey = keyof NotificationPreferences;

const NOTIFICATION_PREFERENCE_KEYS = [
  "morningEmail",
  "eventReminder",
  "eventChange",
] as const satisfies readonly NotificationPreferenceKey[];

const NOTIFICATION_TYPE_BY_KEY: Record<
  NotificationPreferenceKey,
  ApiNotificationPreferenceUpdate["notification_type"]
> = {
  morningEmail: "morning_email",
  eventReminder: "event_reminder",
  eventChange: "event_change",
};

export async function fetchNotificationPreferences(): Promise<NotificationPreferences> {
  const response = await api.get<ApiNotificationPreferencesListResponse>(
    "/notification-preferences",
  );
  return {
    morningEmail:
      response.preferences.find(
        (preference) => preference.notification_type === "morning_email",
      )?.enabled ?? true,
    eventReminder:
      response.preferences.find(
        (preference) => preference.notification_type === "event_reminder",
      )?.enabled ?? true,
    eventChange:
      response.preferences.find(
        (preference) => preference.notification_type === "event_change",
      )?.enabled ?? true,
  };
}

export async function saveNotificationPreferences(
  preferences: NotificationPreferences,
): Promise<void> {
  const payload: ApiNotificationPreferencesBulkUpdate = {
    preferences: NOTIFICATION_PREFERENCE_KEYS.map((key) => ({
        notification_type: NOTIFICATION_TYPE_BY_KEY[key],
        enabled: preferences[key],
      })),
  };
  await api.patch("/notification-preferences", payload);
}
