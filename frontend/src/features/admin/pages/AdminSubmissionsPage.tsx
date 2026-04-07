import React, { useState, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { Search, Check, X as XIcon, ArrowLeft, FileText, Clock, User, ChevronLeft, ChevronRight } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { useAdminSubmissionsFilters } from "@/features/admin/hooks/useAdminSubmissionsFilters";
import { useAdminSubmissionsPagination } from "@/features/admin/hooks/useAdminSubmissionsPagination";
import { useAdminSubmissionsActions } from "@/features/admin/hooks/useAdminSubmissionsActions";
import type { EventSubmission } from "@/shared/types";
import { formatRelativeTime } from "@/shared/utils/relativeTime";

interface AdminSubmissionsPageProps {
  onBack: () => void;
  onApprove?: (submission: EventSubmission) => void;
}

export function AdminSubmissionsPage({
  onBack,
  onApprove,
}: AdminSubmissionsPageProps) {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [refreshKey, setRefreshKey] = useState(0);
  const ITEMS_PER_PAGE = 20;

  // Use hooks for business logic
  const filters = useAdminSubmissionsFilters({ refreshKey });
  const pagination = useAdminSubmissionsPagination({
    itemsPerPage: ITEMS_PER_PAGE,
    filteredSubmissions: filters.filteredSubmissions,
    searchQuery: filters.searchQuery,
    statusFilter: filters.statusFilter,
  });
  const actions = useAdminSubmissionsActions({
    onApprove,
    searchParams,
    setSearchParams,
    setRefreshKey,
  });

  // Get submissionId from URL
  const submissionIdParam = searchParams.get("submissionId");
  const selectedSubmission = useMemo(() => {
    if (submissionIdParam) {
      return filters.allSubmissions.find((s) => s.id === submissionIdParam) || null;
    }
    return null;
  }, [submissionIdParam, filters.allSubmissions]);

  // Check URL parameters on mount for highlighting
  useEffect(() => {
    if (submissionIdParam) {
      setTimeout(() => {
        const element = document.getElementById(`submission-${submissionIdParam}`);
        if (element) {
          element.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, 100);
    }
  }, [submissionIdParam]);


  const fmtTime = (dateStr: string) => formatRelativeTime(dateStr, t);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="secondary" size="icon" onClick={onBack}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center">
          <FileText className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("admin.eventSubmissions")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("admin.reviewSubmissionsDesc")}
          </p>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none z-10" />
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
              <XIcon className="w-4 h-4" />
            </button>
          )}
        </div>
        <Select
          value={filters.statusFilter}
          onValueChange={(value) =>
            filters.setStatusFilter(
              value as "all" | "pending" | "approved" | "rejected"
            )
          }
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder={t("admin.allStatus")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("admin.allStatus")}</SelectItem>
            <SelectItem value="pending">{t("admin.pending")}</SelectItem>
            <SelectItem value="approved">{t("admin.approved")}</SelectItem>
            <SelectItem value="rejected">{t("admin.rejected")}</SelectItem>
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
              <TableRow className="bg-muted">
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
                    className={`cursor-pointer hover:bg-muted/50 ${submissionIdParam === submission.id ? "bg-primary/10" : ""}`}
                    onClick={() => {
                      const newParams = new URLSearchParams(searchParams);
                      newParams.set("submissionId", submission.id);
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
                        <User className="w-3.5 h-3.5" />
                        <span>{submission.submittedBy}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <Clock className="w-3.5 h-3.5" />
                        <span>{fmtTime(submission.submittedAt)}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          submission.status === "approved"
                            ? "bg-success/20 text-success"
                            : submission.status === "rejected"
                            ? "bg-error/20 text-error"
                            : "bg-warning/20 text-warning"
                        }`}
                      >
                        {submission.status}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-2">
                        {submission.status === "pending" && (
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
                              <Check className="w-4 h-4" />
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
                              <XIcon className="w-4 h-4" />
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
      {filters.filteredSubmissions.length > 0 && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            {t("admin.showing")} {(pagination.currentPage - 1) * ITEMS_PER_PAGE + 1} {t("admin.to")}{" "}
            {Math.min(pagination.currentPage * ITEMS_PER_PAGE, filters.filteredSubmissions.length)} {t("common.of")}{" "}
            {filters.filteredSubmissions.length} {t("admin.submissions")}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => pagination.setCurrentPage((prev) => Math.max(1, prev - 1))}
              disabled={pagination.currentPage === 1}
            >
              <ChevronLeft className="w-4 h-4" />
              {t("admin.previous")}
            </Button>
            <div className="flex items-center gap-1">
              {Array.from({ length: Math.min(5, pagination.totalPages) }, (_, i) => {
                let pageNum: number;
                if (pagination.totalPages <= 5) {
                  pageNum = i + 1;
                } else if (pagination.currentPage <= 3) {
                  pageNum = i + 1;
                } else if (pagination.currentPage >= pagination.totalPages - 2) {
                  pageNum = pagination.totalPages - 4 + i;
                } else {
                  pageNum = pagination.currentPage - 2 + i;
                }
                return (
                  <Button
                    key={pageNum}
                    variant={pagination.currentPage === pageNum ? "default" : "outline"}
                    size="sm"
                    onClick={() => pagination.setCurrentPage(pageNum)}
                    className="w-9"
                  >
                    {pageNum}
                  </Button>
                );
              })}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => pagination.setCurrentPage((prev) => Math.min(pagination.totalPages, prev + 1))}
              disabled={pagination.currentPage === pagination.totalPages}
            >
              {t("admin.next")}
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {filters.filteredSubmissions.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 px-4">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
            <FileText className="w-8 h-8 text-muted-foreground" />
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
      <Dialog
        open={selectedSubmission !== null}
        onOpenChange={(open) => {
          if (!open) {
            const newParams = new URLSearchParams(searchParams);
            newParams.delete("submissionId");
            setSearchParams(newParams);
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Submission Details</DialogTitle>
            <DialogDescription>
              Review the event submission details
            </DialogDescription>
          </DialogHeader>

          {selectedSubmission && (
            <div className="space-y-4">
              <div>
                <h3 className="font-semibold text-sm text-foreground mb-1">
                  Title
                </h3>
                <p className="text-sm text-muted-foreground">
                  {selectedSubmission.eventData.title}
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-sm text-foreground mb-1">
                  Organization
                </h3>
                <p className="text-sm text-muted-foreground">
                  {selectedSubmission.eventData.organization}
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-sm text-foreground mb-1">
                  Description
                </h3>
                <p className="text-sm text-muted-foreground">
                  {selectedSubmission.eventData.description || t("common.noDescription")}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h3 className="font-semibold text-sm text-foreground mb-1">
                    Date
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {selectedSubmission.eventData.date}
                  </p>
                </div>
                <div>
                  <h3 className="font-semibold text-sm text-foreground mb-1">
                    Time
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {selectedSubmission.eventData.time}
                  </p>
                </div>
              </div>

              <div>
                <h3 className="font-semibold text-sm text-foreground mb-1">
                  Location
                </h3>
                <p className="text-sm text-muted-foreground">
                  {selectedSubmission.eventData.location}
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-sm text-foreground mb-1">
                  Category
                </h3>
                <p className="text-sm text-muted-foreground">
                  {selectedSubmission.eventData.category || t("common.none")}
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-sm text-foreground mb-1">
                  Price
                </h3>
                <p className="text-sm text-muted-foreground">
                  ${selectedSubmission.eventData.price}
                </p>
              </div>

              {selectedSubmission.eventData.food.length > 0 && (
                <div>
                  <h3 className="font-semibold text-sm text-foreground mb-1">
                    Food Provided
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {selectedSubmission.eventData.food.map((food) => (
                      <span
                        key={food}
                        className="text-xs px-2 py-1 bg-warning/20 text-warning rounded-full"
                      >
                        {food}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <h3 className="font-semibold text-sm text-foreground mb-1">
                  Requires Registration
                </h3>
                <p className="text-sm text-muted-foreground">
                  {selectedSubmission.eventData.requiresRegistration
                    ? t("common.yes")
                    : t("common.no")}
                </p>
              </div>

              <div className="border-t border-border pt-4">
                <h3 className="font-semibold text-sm text-foreground mb-1">
                  Submitted By
                </h3>
                <p className="text-sm text-muted-foreground">
                  {selectedSubmission.submittedBy}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {fmtTime(selectedSubmission.submittedAt)}
                </p>
              </div>

              {selectedSubmission.status === "pending" && (
                <div className="flex gap-2 justify-end pt-4 border-t border-border">
                  <Button
                    variant="outline"
                    onClick={() => {
                      const newParams = new URLSearchParams(searchParams);
                      newParams.delete("submissionId");
                      setSearchParams(newParams);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => actions.handleRejectClick(selectedSubmission)}
                    className="text-error hover:text-error hover:bg-error/10"
                  >
                    {t("admin.reject")}
                  </Button>
                  <Button onClick={() => actions.handleApprove(selectedSubmission)}>
                    {t("admin.approve")}
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>


      {/* Reject Confirmation Dialog */}
      <Dialog
        open={actions.rejectSubmissionId !== null}
        onOpenChange={(open) => {
          if (!open) {
            actions.setRejectSubmissionId(null);
            actions.setRejectionReason("");
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("admin.rejectEventSubmission")}</DialogTitle>
            <DialogDescription>
              {t("admin.rejectSubmissionDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-4">
            <div>
              <label className="text-sm font-medium text-foreground mb-2 block">
                {t("admin.rejectionReason")} <span className="text-error">*</span>
              </label>
              <textarea
                value={actions.rejectionReason}
                onChange={(e) => actions.setRejectionReason(e.target.value)}
                placeholder={t("admin.enterRejectionReason")}
                className="w-full min-h-[100px] px-3 py-2 text-sm border border-border bg-muted text-foreground rounded-lg placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent resize-none"
                required
              />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <Button
                variant="outline"
                onClick={() => {
                  actions.setRejectSubmissionId(null);
                  actions.setRejectionReason("");
                }}
              >
                {t("common.cancel")}
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  actions.handleRejectConfirm(submissionIdParam);
                  setRefreshKey((prev) => prev + 1);
                }}
                disabled={!actions.rejectionReason.trim()}
              >
                {t("admin.confirmRejection")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
