import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getUserId } from "@/features/auth/api/auth.api";
import {
  fetchNotificationPreferences,
  saveNotificationPreference,
  type NotificationPreferenceKey,
  type NotificationPreferences,
} from "@/features/settings/api/notificationPreferences.api";
import { queryKeys } from "@/shared/lib/queryKeys";

interface PreferenceMutation {
  key: NotificationPreferenceKey;
  enabled: boolean;
}

export function useNotifications() {
  const queryClient = useQueryClient();
  const userId = getUserId() ?? "";
  const queryKey = queryKeys.notificationPreferences.byUser(userId);
  const query = useQuery({
    queryKey,
    queryFn: fetchNotificationPreferences,
    enabled: Boolean(userId),
  });
  const mutation = useMutation({
    mutationFn: ({ key, enabled }: PreferenceMutation) =>
      saveNotificationPreference(key, enabled),
    onMutate: async ({ key, enabled }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<NotificationPreferences>(queryKey);
      if (previous) {
        queryClient.setQueryData<NotificationPreferences>(queryKey, {
          ...previous,
          [key]: enabled,
        });
      }
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous);
      }
    },
  });

  return {
    preferences: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    retry: query.refetch,
    isSaving: mutation.isPending,
    updatePreference: (key: NotificationPreferenceKey, enabled: boolean) =>
      mutation.mutate({ key, enabled }),
  };
}
