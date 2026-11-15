import type { ApiNotificationInboxResponse } from "@/shared/generated";
import { api } from "@/shared/services/apiClient";

/** The signed-in user's newest notifications, with how many are unread. */
export async function fetchNotifications(): Promise<ApiNotificationInboxResponse> {
  return api.get<ApiNotificationInboxResponse>("/notifications/");
}

/** Mark every notification the user has as read. */
export async function markNotificationsRead(): Promise<void> {
  await api.post<void>("/notifications/read");
}
