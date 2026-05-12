import React, { useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { SCROLL_INTO_VIEW_DELAY_MS } from "@/shared/constants/ui";
import { useAdminStore } from "@/features/admin/store/admin.store";
import { Search, Check, X as XIcon, ArrowLeft, FileText, Clock, User } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";
import { useAdminSubmissionsFilters } from "@/features/admin/hooks/useAdminSubmissionsFilters";
import { useAdminSubmissionsPagination } from "@/features/admin/hooks/useAdminSubmissionsPagination";
import { useAdminSubmissionsActions } from "@/features/admin/hooks/useAdminSubmissionsActions";
import { AdminPagination } from "@/features/admin/components/shared/AdminPagination";
import { SubmissionDetailsDialog } from "@/features/admin/components/submissions/SubmissionDetailsDialog";
import { RejectSubmissionDialog } from "@/features/admin/components/submissions/RejectSubmissionDialog";
import type { SubmissionStatus } from "@/shared/types";
import { AdminStatusBadge } from "@/features/admin/components/shared/AdminStatusBadge";
import {
  SUBMISSION_PENDING,
  SUBMISSION_APPROVED,
  SUBMISSION_REJECTED,
} from "@/shared/constants/statuses";
import { ADMIN_ITEMS_PER_PAGE } from "@/shared/constants/pagination";
import { formatRelativeTime } from "@/shared/utils/relativeTime";
import { QP } from "@/shared/constants/queryParams";

interface AdminSubmissionsPageProps {
  onBack: () => void;
}

export function AdminSubmissionsPage({
  onBack,
}: AdminSubmissionsPageProps) {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const fetchSubmissions = useAdminStore((s) => s.fetchSubmissions);
  const ITEMS_PER_PAGE = ADMIN_ITEMS_PER_PAGE;

  // Hydrate the shared submissions list (TTL-cached by the store).
  useEffect(() => {
    fetchSubmissions().catch((err) =>
      console.error("Failed to fetch submissions:", err),
    );
  }, [fetchSubmissions]);

  // Use hooks for business logic
  const filters = useAdminSubmissionsFilters();
  const pagination = useAdminSubmissionsPagination({
    itemsPerPage: ITEMS_PER_PAGE,
    filteredSubmissions: filters.filteredSubmissions,
    searchQuery: filters.searchQuery,
    statusFilter: filters.statusFilter,
  });
  const actions = useAdminSubmissionsActions({
    searchParams,
    setSearchParams,
  });

  // Get submissionId from URL
  const submissionIdParam = searchParams.get(QP.SUBMISSION_ID);
  const selectedSubmission = useMemo(() => {
    if (submissionIdParam) {
      return filters.allSubmissions.find((s) => s.id === submissionIdParam) || null;
    }
    return null;
  }, [submissionIdParam, filters.allSubmissions]);

  // Check URL parameters on mount for highlighting
  useEffect(() => {
    if (!submissionIdParam) return;
    const id = setTimeout(() => {
      const element = document.getElementById(`submission-${submissionIdParam}`);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, SCROLL_INTO_VIEW_DELAY_MS);
    return () => clearTimeout(id);
  }, [submissionIdParam]);


  const fmtTime = (dateStr: string) => formatRelativeTime(dateStr, t);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="secondary" size="icon" onClick={onBack}>
          <ArrowLeft className="size-4" />
        </Button>
        <div className="size-12 rounded-full bg-primary/20 flex items-center justify-center">
          <FileText className="size-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{t("admin.eventSubmissions")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("admin.reviewSubmissionsDesc")}
          </p>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none z-10" />
          <Input
            type="text"
            placeholder={t("admin.searchSubmissions")}
            value={filters.searchQuery}
            onChange={(e) => filters.setSearchQuery(e.target.value)}
            className="pl-9 pr-9"
          />
          {filters.searchQuery && (
            <button
              onClick={() => filters.setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground z-10"
            >
              <XIcon className="size-4" />
            </button>
          )}
        </div>
        <Select
          value={filters.statusFilter}
          onValueChange={(value) =>
            filters.setStatusFilter(
              value as "all" | SubmissionStatus
            )
          }
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

      {/* Results Count */}
      <div className="flex items-center justify-between">
        <span className="font-bold text-xl text-foreground">
          {filters.filteredSubmissions.length}{" "}
          {filters.filteredSubmissions.length === 1 ? t("admin.submission") : t("admin.submissions")}
        </span>
      </div>

      {/* Submissions Table */}
      {filters.filteredSubmissions.length > 0 ? (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-secondary">
                <TableHead className="text-xs font-semibold text-foreground">
                  {t("events.eventTitle")}
                </TableHead>
                <TableHead className="text-xs font-semibold text-foreground">
                  {t("events.organization")}
                </TableHead>
                <TableHead className="text-xs font-semibold text-foreground">
                  {t("admin.submittedBy")}
                </TableHead>
                <TableHead className="text-xs font-semibold text-foreground">
                  {t("admin.submittedAt")}
                </TableHead>
                <TableHead className="text-xs font-semibold text-foreground">
                  {t("events.status")}
                </TableHead>
                <TableHead className="text-right text-xs font-semibold text-foreground">
                  {t("common.actions")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagination.paginatedSubmissions.map((submission) => {
                return (
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
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : null}

      {/* Pagination */}
      {filters.filteredSubmissions.length > 0 && (
        <AdminPagination
          currentPage={pagination.currentPage}
          totalPages={pagination.totalPages}
          totalItems={filters.filteredSubmissions.length}
          itemsPerPage={ITEMS_PER_PAGE}
          itemLabel={t("admin.submission")}
          itemLabelPlural={t("admin.submissions")}
          onPageChange={pagination.setCurrentPage}
        />
      )}

      {filters.filteredSubmissions.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 px-4">
          <div className="size-16 rounded-full bg-secondary flex items-center justify-center mb-4">
            <FileText className="size-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-2">
            No submissions found
          </h3>
          <p className="text-sm text-muted-foreground text-center max-w-md">
            No submissions match your current filters.
          </p>
        </div>
      )}

      {/* Submission Details Dialog */}
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

      {/* Reject Confirmation Dialog */}
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
