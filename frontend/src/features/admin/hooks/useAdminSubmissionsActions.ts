import { useState, useCallback } from "react";
import { useAdminStore } from "@/features/admin/store/admin.store";
import type { EventSubmission } from "@/shared/types";

interface UseAdminSubmissionsActionsOptions {
  onReviewed: (submissionId: string) => void;
}

export function useAdminSubmissionsActions({
  onReviewed,
}: UseAdminSubmissionsActionsOptions) {
  const [rejectSubmissionId, setRejectSubmissionId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const approveSubmission = useAdminStore((s) => s.approveSubmission);
  const rejectSubmission = useAdminStore((s) => s.rejectSubmission);

  const handleApprove = useCallback(
    async (submission: EventSubmission) => {
      try {
        await approveSubmission(submission.id);
      } catch (err) {
        console.error("Failed to approve submission:", err);
        return;
      }
      onReviewed(submission.id);
    },
    [approveSubmission, onReviewed],
  );

  const handleRejectClick = useCallback((submission: EventSubmission) => {
    setRejectSubmissionId(submission.id);
    setRejectionReason("");
  }, []);

  const handleRejectConfirm = useCallback(
    async () => {
      if (!rejectSubmissionId || !rejectionReason.trim()) return;
      try {
        await rejectSubmission(rejectSubmissionId, rejectionReason.trim());
      } catch (err) {
        console.error("Failed to reject submission:", err);
        return;
      }
      const rejectedId = rejectSubmissionId;
      setRejectSubmissionId(null);
      setRejectionReason("");
      onReviewed(rejectedId);
    },
    [rejectSubmissionId, rejectionReason, rejectSubmission, onReviewed],
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
