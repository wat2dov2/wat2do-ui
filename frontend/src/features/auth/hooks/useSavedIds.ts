import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getUserId } from "@/features/auth/api/auth.api";
import { useAuthState } from "@/features/auth/hooks/useAuthState";
import { toast } from "@/shared/hooks/use-toast";

/**
 * One kind of thing a signed-in user can save to their profile (events,
 * positions): its cache keys, how to read the saved ids and how to save or
 * unsave one.
 */
export interface SavedKind {
  keys: { all: readonly unknown[]; byUser: (userId: string) => readonly unknown[] };
  fetchIds: () => Promise<number[]>;
  save: (id: number) => Promise<void>;
  unsave: (id: number) => Promise<void>;
  staleTime: number;
}

/** The ids the signed-in user saved of one kind, latest save first. */
export function useSavedIds(kind: SavedKind) {
  const { isAuthenticated } = useAuthState();
  const userId = isAuthenticated ? getUserId() : undefined;

  return useQuery({
    queryKey: kind.keys.byUser(userId ?? ""),
    queryFn: kind.fetchIds,
    enabled: Boolean(userId),
    staleTime: kind.staleTime,
  });
}

interface SaveVariables {
  save: boolean;
  userId: string | undefined;
}

/** Whether the user saved this one, and a toggle that shows the change at once and says so when it fails. */
export function useSavedIdToggle(kind: SavedKind, id: number, failedMessage: string) {
  const queryClient = useQueryClient();
  const { data: savedIds = [] } = useSavedIds(kind);
  const isSaved = savedIds.includes(id);

  const mutation = useMutation({
    mutationKey: kind.keys.all,
    mutationFn: ({ save }: SaveVariables) => (save ? kind.save(id) : kind.unsave(id)),
    onMutate: async ({ save, userId }) => {
      const queryKey = kind.keys.byUser(userId ?? "");
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<number[]>(queryKey) ?? [];
      const without = previous.filter((savedId) => savedId !== id);
      queryClient.setQueryData<number[]>(queryKey, save ? [id, ...without] : without);
      return { previous, queryKey };
    },
    onError: (_error, _variables, context) => {
      if (context) queryClient.setQueryData(context.queryKey, context.previous);
      toast({ description: failedMessage, variant: "destructive" });
    },
    onSettled: (_response, _error, { userId }) =>
      queryClient.isMutating({ mutationKey: kind.keys.all }) === 1
        ? queryClient.invalidateQueries({ queryKey: kind.keys.byUser(userId ?? "") })
        : Promise.resolve(),
  });

  return {
    isSaved,
    isPending: mutation.isPending,
    toggle: () => mutation.mutate({ save: !isSaved, userId: getUserId() }),
  };
}
