import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getInstagramPublishBatches,
  publishInstagramBatch,
  updateInstagramPublishBatch,
} from "@/features/admin/api/admin.api";
import type {
  ApiInstagramPublishBatchPublish,
  ApiInstagramPublishBatchResponse,
  ApiInstagramPublishBatchUpdate,
} from "@/shared/generated";
import { queryKeys } from "@/shared/lib/queryKeys";

interface UpdateVariables {
  id: string;
  data: ApiInstagramPublishBatchUpdate;
}

interface PublishVariables {
  id: string;
  data: ApiInstagramPublishBatchPublish;
}

export function useInstagramPublishing() {
  const queryClient = useQueryClient();
  const queryKey = queryKeys.instagramPublishing.batches();
  const query = useQuery({
    queryKey,
    queryFn: getInstagramPublishBatches,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey });
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: UpdateVariables) =>
      updateInstagramPublishBatch(id, data),
    // A save returns the batch it wrote, so the editor picks up its new slides
    // and version straight away instead of waiting on a refetch.
    onSuccess: (saved) =>
      queryClient.setQueryData<ApiInstagramPublishBatchResponse[]>(queryKey, (current) =>
        (current ?? []).map((batch) => (batch.id === saved.id ? saved : batch)),
      ),
  });
  const publishMutation = useMutation({
    mutationFn: ({ id, data }: PublishVariables) =>
      publishInstagramBatch(id, data),
    onSuccess: refresh,
  });

  return {
    batches: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    retry: query.refetch,
    updateBatch: updateMutation.mutateAsync,
    publishBatch: publishMutation.mutateAsync,
    updatingBatchId: updateMutation.variables?.id ?? null,
    publishingBatchId: publishMutation.variables?.id ?? null,
  };
}
