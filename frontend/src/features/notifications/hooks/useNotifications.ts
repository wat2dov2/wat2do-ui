import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import notificationInbox from "../../../../../backend/controlbox/notification_inbox.json" with { type: "json" };
import { useAuthState } from "@/features/auth/hooks/useAuthState";
import {
  fetchNotifications,
  markNotificationsRead,
} from "@/features/notifications/api/notifications.api";
import type { ApiNotificationInboxResponse } from "@/shared/generated";
import { queryKeys } from "@/shared/lib/queryKeys";

const REFRESH_MS = notificationInbox.refresh_seconds * 1000;

/**
 * The signed-in user's inbox, checked again every `refresh_seconds` and on
 * return to the tab. Keyed by whose inbox it is, so it stays off until that
 * is known.
 */
export function useNotifications() {
  const { userId } = useAuthState();
  return useQuery({
    queryKey: queryKeys.notifications.inbox(userId ?? ""),
    queryFn: fetchNotifications,
    enabled: Boolean(userId),
    staleTime: REFRESH_MS,
    refetchInterval: REFRESH_MS,
    refetchOnWindowFocus: true,
  });
}

/**
 * Marks read the notifications an open list showed, and only those. The count
 * drops at once; they keep their unread look until the list closes and the
 * inbox is read again, so the visitor can still tell what was new.
 */
export function useMarkNotificationsRead() {
  const queryClient = useQueryClient();
  const { userId } = useAuthState();
  const queryKey = queryKeys.notifications.inbox(userId ?? "");
  return useMutation({
    mutationFn: markNotificationsRead,
    onMutate: async (ids: string[]) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<ApiNotificationInboxResponse>(queryKey);
      if (previous) {
        const marked = new Set(ids);
        const stillUnread = previous.notifications.filter(
          (notification) => !notification.read && !marked.has(notification.id),
        ).length;
        queryClient.setQueryData(queryKey, { ...previous, unread_count: stillUnread });
      }
      return { previous };
    },
    onError: (_error, _ids, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
    },
  });
}
