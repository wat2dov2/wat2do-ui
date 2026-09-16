import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/shared/lib/queryKeys";
import { updateEventSubmission } from "@/features/admin/api/admin.api";
import type { EventSubmission } from "@/shared/types";

interface UseAdminSubmissionsActionsOptions {
  onReviewed: (submissionId: string) => void;
}

export function useAdminSubmissionsActions({
  onReviewed,
}: UseAdminSubmissionsActionsOptions) {
  const [rejectSubmissionId, setRejectSubmissionId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const queryClient = useQueryClient();

  const handleApprove = useCallback(
    async (submission: EventSubmission) => {
      try {
        await updateEventSubmission(submission.id, "approved");
        await queryClient.invalidateQueries({ queryKey: queryKeys.admin.all });
        await queryClient.invalidateQueries({ queryKey: queryKeys.events.all });
      } catch (err) {
        console.error("Failed to approve submission:", err);
        return;
      }
      onReviewed(submission.id);
    },
    [queryClient, onReviewed],
  );

  const handleRejectClick = useCallback((submission: EventSubmission) => {
    setRejectSubmissionId(submission.id);
    setRejectionReason("");
  }, []);

  const handleRejectConfirm = useCallback(
    async () => {
      if (!rejectSubmissionId || !rejectionReason.trim()) return;
      try {
        await updateEventSubmission(rejectSubmissionId, "rejected", rejectionReason.trim());
        await queryClient.invalidateQueries({ queryKey: queryKeys.admin.all });
      } catch (err) {
        console.error("Failed to reject submission:", err);
        return;
      }
      const rejectedId = rejectSubmissionId;
      setRejectSubmissionId(null);
      setRejectionReason("");
      onReviewed(rejectedId);
    },
    [rejectSubmissionId, rejectionReason, queryClient, onReviewed],
  );

  return {
    rejectSubmissionId,
    setRejectSubmissionId,
    rejectionReason,
    setRejectionReason,
    handleApprove,
    handleRejectClick,
    handleRejectConfirm,
  };
}
