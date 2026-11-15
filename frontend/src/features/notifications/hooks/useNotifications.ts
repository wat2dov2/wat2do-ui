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

/** The signed-in user's inbox, checked again every `refresh_seconds` and on return to the tab. */
export function useNotifications() {
  const { isAuthenticated, userId } = useAuthState();
  return useQuery({
    queryKey: queryKeys.notifications.inbox(userId ?? ""),
    queryFn: fetchNotifications,
    enabled: isAuthenticated,
    staleTime: REFRESH_MS,
    refetchInterval: REFRESH_MS,
    refetchOnWindowFocus: true,
  });
}

/**
 * Marks the inbox read when the visitor opens it. The count clears at once;
 * the notifications keep their unread look until the list closes and the
 * inbox is read again, so the visitor can still tell what is new.
 */
export function useMarkNotificationsRead() {
  const queryClient = useQueryClient();
  const { userId } = useAuthState();
  const queryKey = queryKeys.notifications.inbox(userId ?? "");
  return useMutation({
    mutationFn: markNotificationsRead,
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<ApiNotificationInboxResponse>(queryKey);
      if (previous) queryClient.setQueryData(queryKey, { ...previous, unread_count: 0 });
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
    },
  });
}
