import { api } from "@/shared/services/apiClient";
import type { components } from "@/shared/generated/api-types";
import notificationDefaults from "../../../../../backend/controlbox/notification_defaults.json";

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

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  morningEmail: notificationDefaults.morning_email,
  eventReminder: notificationDefaults.event_reminder,
  eventChange: notificationDefaults.event_change,
};

export async function fetchNotificationPreferences(): Promise<NotificationPreferences> {
  const response = await api.get<ApiNotificationPreferencesListResponse>(
    "/notification-preferences",
  );
  const preferences = { ...DEFAULT_NOTIFICATION_PREFERENCES };
  for (const key of NOTIFICATION_PREFERENCE_KEYS) {
    preferences[key] = response.preferences.find(
      (preference) => preference.notification_type === NOTIFICATION_TYPE_BY_KEY[key],
    )?.enabled ?? DEFAULT_NOTIFICATION_PREFERENCES[key];
  }
  return preferences;
}

export async function saveNotificationPreferences(
  preferences: NotificationPreferences,
  previous: NotificationPreferences,
): Promise<void> {
  const payload: ApiNotificationPreferencesBulkUpdate = {
    preferences: NOTIFICATION_PREFERENCE_KEYS.filter(
      (key) => preferences[key] !== previous[key],
    ).map((key) => ({
      notification_type: NOTIFICATION_TYPE_BY_KEY[key],
      enabled: preferences[key],
    })),
  };
  if (payload.preferences.length === 0) return;
  await api.patch("/notification-preferences", payload);
}
