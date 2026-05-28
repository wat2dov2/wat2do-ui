import { useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { Check, Clock, FileText, User, X as XIcon } from "lucide-react";
import { Button } from "@/shared/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { TableCell, TableRow } from "@/shared/ui/table";
import { AdminPageHeader } from "@/features/admin/components/shared/AdminPageHeader";
import { AdminSearchBar } from "@/features/admin/components/shared/AdminSearchBar";
import { AdminResultsCount } from "@/features/admin/components/shared/AdminResultsCount";
import { Pagination } from "@/shared/ui/Pagination";
import { AdminEmptyState } from "@/features/admin/components/shared/AdminEmptyState";
import { AdminTable } from "@/features/admin/components/shared/AdminTable";
import { AdminStatusBadge } from "@/features/admin/components/shared/AdminStatusBadge";
import { SubmissionDetailsDialog } from "@/features/admin/components/submissions/SubmissionDetailsDialog";
import { RejectSubmissionDialog } from "@/features/admin/components/submissions/RejectSubmissionDialog";
import { useAdminStore } from "@/features/admin/store/admin.store";
import { useAdminSubmissionsFilters } from "@/features/admin/hooks/useAdminSubmissionsFilters";
import { useAdminSubmissionsPagination } from "@/features/admin/hooks/useAdminSubmissionsPagination";
import { useAdminSubmissionsActions } from "@/features/admin/hooks/useAdminSubmissionsActions";
import {
  SUBMISSION_PENDING,
  SUBMISSION_APPROVED,
  SUBMISSION_REJECTED,
} from "@/shared/constants/statuses";
import { ADMIN_ITEMS_PER_PAGE } from "@/features/admin/constants";
import { SCROLL_INTO_VIEW_DELAY_MS } from "@/shared/constants/ui";
import { formatRelativeTime } from "@/shared/utils/relativeTime";
import { QP } from "@/shared/constants/queryParams";
import type { SubmissionStatus } from "@/shared/types";

interface AdminSubmissionsPageProps {
  onBack: () => void;
}

export function AdminSubmissionsPage({ onBack }: AdminSubmissionsPageProps) {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const fetchSubmissions = useAdminStore((s) => s.fetchSubmissions);

  useEffect(() => {
    fetchSubmissions().catch((err) =>
      console.error("Failed to fetch submissions:", err),
    );
  }, [fetchSubmissions]);

  const filters = useAdminSubmissionsFilters();
  const pagination = useAdminSubmissionsPagination({
    itemsPerPage: ADMIN_ITEMS_PER_PAGE,
    filteredSubmissions: filters.filteredSubmissions,
  });
  const actions = useAdminSubmissionsActions({
    searchParams,
    setSearchParams,
  });

  const submissionIdParam = searchParams.get(QP.SUBMISSION_ID);
  const selectedSubmission = useMemo(() => {
    if (!submissionIdParam) return null;
    return filters.allSubmissions.find((s) => s.id === submissionIdParam) || null;
  }, [submissionIdParam, filters.allSubmissions]);

  useEffect(() => {
    if (!submissionIdParam) return;
    const id = setTimeout(() => {
      document
        .getElementById(`submission-${submissionIdParam}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, SCROLL_INTO_VIEW_DELAY_MS);
    return () => clearTimeout(id);
  }, [submissionIdParam]);

  const fmtTime = (dateStr: string) => formatRelativeTime(dateStr, t);

  return (
    <div className="space-y-5">
      <AdminPageHeader
        icon={FileText}
        title={t("admin.eventSubmissions")}
        description={t("admin.reviewSubmissionsDesc")}
        onBack={onBack}
      />

      <div className="flex gap-3">
        <AdminSearchBar
          value={filters.searchQuery}
          onChange={(value) => {
            filters.setSearchQuery(value);
            pagination.setCurrentPage(1);
          }}
          placeholder={t("admin.searchSubmissions")}
        />
        <Select
          value={filters.statusFilter}
          onValueChange={(value) => {
            filters.setStatusFilter(value as "all" | SubmissionStatus);
            pagination.setCurrentPage(1);
          }}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder={t("admin.allStatus")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("admin.allStatus")}</SelectItem>
            <SelectItem value={SUBMISSION_PENDING}>{t("admin.pending")}</SelectItem>
            <SelectItem value={SUBMISSION_APPROVED}>{t("admin.approved")}</SelectItem>
            <SelectItem value={SUBMISSION_REJECTED}>{t("admin.rejected")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <AdminResultsCount
        count={filters.filteredSubmissions.length}
        singularLabel={t("admin.submission")}
        pluralLabel={t("admin.submissions")}
      />

      {filters.filteredSubmissions.length > 0 ? (
        <AdminTable
          headers={[
            { label: t("events.eventTitle") },
            { label: t("events.organization") },
            { label: t("admin.submittedBy") },
            { label: t("admin.submittedAt") },
            { label: t("events.status") },
            { label: t("common.actions"), align: "right" },
          ]}
        >
          {pagination.paginatedSubmissions.map((submission) => (
            <TableRow
              key={submission.id}
              id={`submission-${submission.id}`}
              className={`cursor-pointer hover:bg-secondary/50 ${submissionIdParam === submission.id ? "bg-primary/10" : ""}`}
              onClick={() => {
                const newParams = new URLSearchParams(searchParams);
                newParams.set(QP.SUBMISSION_ID, submission.id);
                setSearchParams(newParams);
              }}
            >
              <TableCell>
                <div className="font-medium text-sm text-foreground">
                  {submission.eventData.title}
                </div>
              </TableCell>
              <TableCell>
                <div className="text-sm text-muted-foreground">
                  {submission.eventData.organization}
                </div>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <User className="size-3.5" />
                  <span>{submission.submittedBy}</span>
                </div>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Clock className="size-3.5" />
                  <span>{fmtTime(submission.submittedAt)}</span>
                </div>
              </TableCell>
              <TableCell>
                <AdminStatusBadge status={submission.status} />
              </TableCell>
              <TableCell>
                <div className="flex items-center justify-end gap-2">
                  {submission.status === SUBMISSION_PENDING && (
                    <>
                      <Button
                        variant="secondary"
                        size="sm"
                        title={t("admin.approve")}
                        onClick={(e) => {
                          e.stopPropagation();
                          actions.handleApprove(submission);
                        }}
                        className="text-success hover:text-success hover:bg-success/10"
                      >
                        <Check className="size-4" />
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        title={t("admin.reject")}
                        onClick={(e) => {
                          e.stopPropagation();
                          actions.handleRejectClick(submission);
                        }}
                        className="text-error hover:text-error hover:bg-error/10"
                      >
                        <XIcon className="size-4" />
                      </Button>
                    </>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </AdminTable>
      ) : (
        <AdminEmptyState
          icon={FileText}
          title={t("admin.noSubmissionsFound")}
          description={t("admin.noSubmissionsMatchFilters")}
        />
      )}

      {filters.filteredSubmissions.length > 0 && (
        <Pagination
          currentPage={pagination.currentPage}
          totalPages={pagination.totalPages}
          totalItems={filters.filteredSubmissions.length}
          itemsPerPage={ADMIN_ITEMS_PER_PAGE}
          itemLabel={t("admin.submission")}
          itemLabelPlural={t("admin.submissions")}
          onPageChange={pagination.setCurrentPage}
        />
      )}

      <SubmissionDetailsDialog
        submission={selectedSubmission}
        isOpen={selectedSubmission !== null}
        onClose={() => {
          const newParams = new URLSearchParams(searchParams);
          newParams.delete(QP.SUBMISSION_ID);
          setSearchParams(newParams);
        }}
        onApprove={actions.handleApprove}
        onRejectClick={actions.handleRejectClick}
        formatRelativeTime={fmtTime}
      />

      <RejectSubmissionDialog
        isOpen={actions.rejectSubmissionId !== null}
        rejectionReason={actions.rejectionReason}
        onClose={() => {
          actions.setRejectSubmissionId(null);
          actions.setRejectionReason("");
        }}
        onConfirm={() => {
          actions.handleRejectConfirm(submissionIdParam);
        }}
        onRejectionReasonChange={actions.setRejectionReason}
      />
    </div>
  );
}
