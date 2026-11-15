import type { ApiNotificationInboxResponse } from "@/shared/generated";
import { api } from "@/shared/services/apiClient";

/** The signed-in user's newest notifications, with how many of those are unread. */
export async function fetchNotifications(): Promise<ApiNotificationInboxResponse> {
  return api.get<ApiNotificationInboxResponse>("/notifications/");
}

/** Mark read the notifications an open list showed; any that arrived since stay unread. */
export async function markNotificationsRead(notificationIds: string[]): Promise<void> {
  await api.post<void>("/notifications/read", { notification_ids: notificationIds });
}
