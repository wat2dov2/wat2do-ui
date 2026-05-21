import { useState, useCallback } from "react";
import { useAdminStore } from "@/features/admin/store/admin.store";
import type { EventSubmission } from "@/shared/types";
import { QP } from "@/shared/constants/queryParams";

interface UseAdminSubmissionsActionsOptions {
  searchParams: URLSearchParams;
  setSearchParams: (
    params: URLSearchParams | ((prev: URLSearchParams) => URLSearchParams),
  ) => void;
}

export function useAdminSubmissionsActions({
  searchParams,
  setSearchParams,
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
      const newParams = new URLSearchParams(searchParams);
      newParams.delete(QP.SUBMISSION_ID);
      setSearchParams(newParams);
    },
    [approveSubmission, searchParams, setSearchParams],
  );

  const handleRejectClick = useCallback((submission: EventSubmission) => {
    setRejectSubmissionId(submission.id);
    setRejectionReason("");
  }, []);

  const handleRejectConfirm = useCallback(
    async (submissionIdParam: string | null) => {
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
      if (submissionIdParam === rejectedId) {
        const newParams = new URLSearchParams(searchParams);
        newParams.delete(QP.SUBMISSION_ID);
        setSearchParams(newParams);
      }
    },
    [rejectSubmissionId, rejectionReason, rejectSubmission, searchParams, setSearchParams],
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
