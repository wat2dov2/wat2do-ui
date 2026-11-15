import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getUserId } from "@/features/auth/api/auth.api";
import { useAuthState } from "@/features/auth/hooks/useAuthState";
import {
  fetchSavedEventIds,
  saveEvent,
  unsaveEvent,
} from "@/features/events/api/events.api";
import { controlBox } from "@/shared/config/controlBox";
import { toast } from "@/shared/hooks/use-toast";
import { queryKeys } from "@/shared/lib/queryKeys";

/** The ids of the events the signed-in user saved, latest save first. */
export function useSavedEventIds() {
  const { isAuthenticated } = useAuthState();
  const userId = isAuthenticated ? getUserId() : undefined;

  return useQuery({
    queryKey: queryKeys.savedEvents.byUser(userId ?? ""),
    queryFn: fetchSavedEventIds,
    enabled: Boolean(userId),
    staleTime: controlBox.clientCache.liveEventDataStaleMs,
  });
}

interface SaveVariables {
  save: boolean;
  userId: string | undefined;
}

/** Whether the user saved this event, and a toggle that shows the change at once. */
export function useSavedEventToggle(eventId: number) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: savedIds = [] } = useSavedEventIds();
  const isSaved = savedIds.includes(eventId);

  const mutation = useMutation({
    mutationKey: queryKeys.savedEvents.all,
    mutationFn: ({ save }: SaveVariables) => (save ? saveEvent(eventId) : unsaveEvent(eventId)),
    onMutate: async ({ save, userId }) => {
      const queryKey = queryKeys.savedEvents.byUser(userId ?? "");
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<number[]>(queryKey) ?? [];
      const without = previous.filter((id) => id !== eventId);
      queryClient.setQueryData<number[]>(queryKey, save ? [eventId, ...without] : without);
      return { previous, queryKey };
    },
    onError: (_error, _variables, context) => {
      if (context) queryClient.setQueryData(context.queryKey, context.previous);
      toast({ description: t("events.savedEvents.saveFailed"), variant: "destructive" });
    },
    onSettled: (_response, _error, { userId }) =>
      queryClient.isMutating({ mutationKey: queryKeys.savedEvents.all }) === 1
        ? queryClient.invalidateQueries({ queryKey: queryKeys.savedEvents.byUser(userId ?? "") })
        : Promise.resolve(),
  });

  return {
    isSaved,
    isPending: mutation.isPending,
    toggle: () => mutation.mutate({ save: !isSaved, userId: getUserId() }),
  };
}
