import { useState, useCallback } from "react";
import { updateEventSubmission } from "@/features/admin/api/admin.api";
import type { EventSubmission } from "@/shared/types";

interface UseAdminSubmissionsActionsOptions {
  onApprove?: (submission: EventSubmission) => void;
  searchParams: URLSearchParams;
  setSearchParams: (params: URLSearchParams | ((prev: URLSearchParams) => URLSearchParams)) => void;
  setRefreshKey: (key: number | ((prev: number) => number)) => void;
}

/**
 * Hook for managing submission actions (approve/reject) in AdminSubmissionsPage
 */
export function useAdminSubmissionsActions({
  onApprove,
  searchParams,
  setSearchParams,
  setRefreshKey,
}: UseAdminSubmissionsActionsOptions) {
  const [rejectSubmissionId, setRejectSubmissionId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");

  const handleApprove = useCallback(async (submission: EventSubmission) => {
    await updateEventSubmission(submission.id, "approved");
    if (onApprove) {
      onApprove(submission);
    }
    const newParams = new URLSearchParams(searchParams);
    newParams.delete("submissionId");
    setSearchParams(newParams);
    setRefreshKey((prev) => prev + 1);
  }, [onApprove, searchParams, setSearchParams, setRefreshKey]);

  const handleRejectClick = useCallback((submission: EventSubmission) => {
    setRejectSubmissionId(submission.id);
    setRejectionReason("");
  }, []);

  const handleRejectConfirm = useCallback(async (submissionIdParam: string | null) => {
    if (rejectSubmissionId && rejectionReason.trim()) {
      await updateEventSubmission(rejectSubmissionId, "rejected", rejectionReason.trim());
      setRejectSubmissionId(null);
      setRejectionReason("");
      setRefreshKey((prev) => prev + 1);

      // Close modal if the rejected submission was open
      if (submissionIdParam === rejectSubmissionId) {
        const newParams = new URLSearchParams(searchParams);
        newParams.delete("submissionId");
        setSearchParams(newParams);
      }
    }
  }, [rejectSubmissionId, rejectionReason, searchParams, setSearchParams, setRefreshKey]);

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
