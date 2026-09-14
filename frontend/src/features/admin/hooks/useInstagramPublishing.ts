import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getInstagramPublishBatch,
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
import instagramPublishingControl from "../../../../../backend/controlbox/instagram_publishing.json";

const statusPollInterval = instagramPublishingControl.status_poll_interval_seconds * 1000;

interface UpdateVariables {
  id: string;
  data: ApiInstagramPublishBatchUpdate;
}

interface PublishVariables {
  id: string;
  data: ApiInstagramPublishBatchPublish;
}

function batchDetailQuery(id: string) {
  return { queryKey: queryKeys.instagramPublishing.batch(id), queryFn: () => getInstagramPublishBatch(id) };
}

export function useInstagramPublishing(
  pageNumber: number,
  pageSize: number,
  selectedBatchId: string | null,
) {
  const queryClient = useQueryClient();
  const listQuery = useQuery({
    queryKey: queryKeys.instagramPublishing.batchPage(pageNumber, pageSize),
    queryFn: () => getInstagramPublishBatches(pageNumber, pageSize),
    placeholderData: (previous) => previous,
    refetchInterval: (query) => query.state.data?.items.some((batch) => batch.status === "publishing") ? statusPollInterval : false,
  });
  const detailQuery = useQuery({
    ...batchDetailQuery(selectedBatchId ?? ""),
    enabled: selectedBatchId !== null,
    refetchInterval: (query) => query.state.data?.status === "publishing" ? statusPollInterval : false,
  });
  const prefetchBatch = useCallback((id: string) => {
    void queryClient.prefetchQuery(batchDetailQuery(id));
  }, [queryClient]);
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: queryKeys.instagramPublishing.batches(),
    });
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: UpdateVariables) =>
      updateInstagramPublishBatch(id, data),
    // A save returns the batch it wrote, so the editor picks up its new slides
    // and version straight away instead of waiting on a refetch.
    onSuccess: (saved) => {
      queryClient.setQueryData<ApiInstagramPublishBatchResponse>(
        queryKeys.instagramPublishing.batch(saved.id),
        saved,
      );
      return refresh();
    },
  });
  const publishMutation = useMutation({
    mutationFn: ({ id, data }: PublishVariables) =>
      publishInstagramBatch(id, data),
    onSuccess: (saved) => {
      queryClient.setQueryData<ApiInstagramPublishBatchResponse>(
        queryKeys.instagramPublishing.batch(saved.id),
        saved,
      );
      return refresh();
    },
  });

  return {
    page: listQuery.data,
    isLoading: listQuery.isLoading,
    isFetching: listQuery.isFetching,
    error: listQuery.error,
    retry: listQuery.refetch,
    batch: detailQuery.data,
    isDetailLoading: detailQuery.isLoading,
    detailError: detailQuery.error,
    retryDetail: detailQuery.refetch,
    prefetchBatch,
    updateBatch: updateMutation.mutateAsync,
    publishBatch: publishMutation.mutateAsync,
    // A mutation keeps its variables after it settles, so the batch being
    // worked on is only meaningful while the request is still in flight.
    updatingBatchId: updateMutation.isPending ? (updateMutation.variables?.id ?? null) : null,
    publishingBatchId: publishMutation.isPending ? (publishMutation.variables?.id ?? null) : null,
  };
}
