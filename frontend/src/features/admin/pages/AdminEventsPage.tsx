import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Calendar, AlertTriangle, FileText } from "@/shared/ui/doodle-icons";
import { Button } from "@/shared/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import {
  TableCell,
  TableRow,
} from "@/shared/ui/table";
import { EventDetailsModal, useEventsStore } from "@/features/events";
import { useAdminEventsPage } from "@/features/admin/hooks/useAdminEventsPage";
import type { Event, SubmissionStatus } from "@/shared/types";
import { AdminPageHeader } from "@/features/admin/components/shared/AdminPageHeader";
import { AdminSearchBar } from "@/features/admin/components/shared/AdminSearchBar";
import { AdminResultsCount } from "@/features/admin/components/shared/AdminResultsCount";
import { Pagination } from "@/shared/ui/Pagination";
import { AdminEmptyState } from "@/features/admin/components/shared/AdminEmptyState";
import { AdminDeleteDialog } from "@/features/admin/components/shared/AdminDeleteDialog";
import { AdminTable } from "@/features/admin/components/shared/AdminTable";
import { cn } from "@/shared/lib/utils";
import { ADMIN_ITEMS_PER_PAGE } from "@/features/admin/constants";
import { QP } from "@/shared/constants/queryParams";
import { formatCardDate } from "@/shared/utils/date";
import { useUIStore } from "@/shared/store/ui.store";

import { AdminStatusBadge } from "@/features/admin/components/shared/AdminStatusBadge";
import { SubmissionDetailsDialog } from "@/features/admin/components/submissions/SubmissionDetailsDialog";
import { RejectSubmissionDialog } from "@/features/admin/components/submissions/RejectSubmissionDialog";
import { useAdminStore } from "@/features/admin/store/admin.store";
import { useOrganizationNameLookup } from "@/features/organizations";
import { useAdminSubmissionsFilters } from "@/features/admin/hooks/useAdminSubmissionsFilters";
import { usePagination } from "@/shared/hooks";
import { useAdminSubmissionsActions } from "@/features/admin/hooks/useAdminSubmissionsActions";
import {
  SUBMISSION_PENDING,
  SUBMISSION_APPROVED,
  SUBMISSION_REJECTED,
} from "@/shared/constants/statuses";
import { SCROLL_INTO_VIEW_DELAY_MS } from "@/shared/constants/ui";
import { formatRelativeTime } from "@/shared/utils/relativeTime";
import { useMutableSearchParams } from "@/shared/hooks/useMutableSearchParams";

const ITEMS_PER_PAGE = ADMIN_ITEMS_PER_PAGE;

interface AdminEventsPageProps {
  onBack: () => void;
}

export function AdminEventsPage({
  onBack,
}: AdminEventsPageProps) {
  const { t, i18n } = useTranslation();
  const [searchParams, setSearchParams] = useMutableSearchParams();

  const submissionIdParam = searchParams.get(QP.SUBMISSION_ID);
  const initialTab = (searchParams.get("tab") === "submissions" || submissionIdParam) ? "submissions" : "events";
  const [activeTab, setActiveTab] = useState<"events" | "submissions">(initialTab);

  const events = useEventsStore((s) => s.events);
  const deleteEvent = useEventsStore((s) => s.deleteEvent);
  const setEditingEvent = useUIStore((s) => s.setEditingEvent);
  const setShowSubmitEvent = useUIStore((s) => s.setShowSubmitEvent);

  const onEditEvent = (event: Event) => {
    setEditingEvent(event);
    setShowSubmitEvent(true);
  };

  const {
    searchQuery,
    selectedCategory,
    showReportedOnly,
    deleteConfirmId,
    highlightedEventId,
    currentPage,
    selectedEvent,
    categories,
    filteredEvents,
    paginatedEvents,
    totalPages,
    setSearchQuery,
    setSelectedCategory,
    toggleReportedOnly,
    setDeleteConfirmId,
    setCurrentPage,
    isEventReported,
  } = useAdminEventsPage({ events, itemsPerPage: ITEMS_PER_PAGE });

  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async (eventId: number) => {
    setIsDeleting(true);
    try {
      await Promise.resolve(deleteEvent(eventId));
      setDeleteConfirmId(null);
    } finally {
      setIsDeleting(false);
    }
  };

  const fetchSubmissions = useAdminStore((s) => s.fetchSubmissions);
  const allSubmissions = useAdminStore((s) => s.submissions);

  const schoolFilter = useEventsStore((s) => s.schoolFilter);

  useEffect(() => {
    fetchSubmissions(schoolFilter ?? undefined).catch((err) =>
      console.error("Failed to fetch submissions:", err),
    );
  }, [fetchSubmissions, schoolFilter]);

  const pendingSubmissionsCount = useMemo(() => {
    return allSubmissions.filter((s) => s.status === SUBMISSION_PENDING).length;
  }, [allSubmissions]);

  const { getOrganizationName } = useOrganizationNameLookup();
  const submissionFilters = useAdminSubmissionsFilters({ getOrganizationName });
  const submissionPagination = usePagination({
    items: submissionFilters.filteredSubmissions,
    itemsPerPage: ITEMS_PER_PAGE,
  });
  const submissionActions = useAdminSubmissionsActions({
    searchParams,
    setSearchParams,
  });

  const selectedSubmission = useMemo(() => {
    if (!submissionIdParam) return null;
    return submissionFilters.allSubmissions.find((s) => s.id === submissionIdParam) || null;
  }, [submissionIdParam, submissionFilters.allSubmissions]);

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
        icon={Calendar}
        title={t("admin.manageEvents")}
        description={t("admin.manageEventsDesc")}
        onBack={onBack}
      />

      <div className="flex gap-2 border-b border-border pb-3">
        <button
          onClick={() => setActiveTab("events")}
          data-elevation="control"
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all cursor-pointer ${
            activeTab === "events"
              ? "bg-primary/80 text-primary-foreground font-semibold"
              : "bg-secondary text-muted-foreground hover:bg-muted/60 dark:hover:bg-muted/60"
          }`}
        >
          {t("admin.eventsList")}
        </button>
        <button
          onClick={() => setActiveTab("submissions")}
          data-elevation="control"
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all cursor-pointer relative ${
            activeTab === "submissions"
              ? "bg-primary/80 text-primary-foreground font-semibold"
              : "bg-secondary text-muted-foreground hover:bg-muted/60 dark:hover:bg-muted/60"
          }`}
        >
          {t("admin.eventSubmissions")}
          {pendingSubmissionsCount > 0 && (
            <span className="ml-1.5 px-1.5 py-0.5 text-[10px] bg-foreground/30 text-primary-foreground rounded-full font-bold">
              {pendingSubmissionsCount}
            </span>
          )}
        </button>
      </div>

      {activeTab === "events" ? (
        <>
          <div className="flex gap-3">
            <AdminSearchBar
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder={t("admin.searchEvents")}
            />
            <Select
              value={selectedCategory || undefined}
              onValueChange={(value) => setSelectedCategory(value || "")}
            >
              <SelectTrigger showIcon={false} className="h-11 w-[180px]">
                <SelectValue placeholder={t("admin.allCategories")} />
              </SelectTrigger>
              <SelectContent>
                {categories.map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    {cat}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={toggleReportedOnly}
              aria-pressed={showReportedOnly}
              className={cn(
                "flex items-center gap-2 px-3 py-1 h-9 whitespace-nowrap [&_svg]:shrink-0 [&_svg]:size-4 transition-all",
                showReportedOnly
                  ? "bg-primary/80! text-primary-foreground! hover:bg-primary/80! hover:text-primary-foreground! [&_svg]:text-primary-foreground!"
                  : "bg-secondary text-muted-foreground hover:bg-secondary"
              )}
            >
              <AlertTriangle className="size-4" />
              {t("admin.reportedOnly")}
            </Button>
          </div>

          <AdminResultsCount
            count={filteredEvents.length}
            singularLabel={t("common.event")}
            pluralLabel={t("common.events")}
          />

          {filteredEvents.length > 0 ? (
            <AdminTable
              headers={[
                { label: t("events.eventTitle") },
                { label: t("events.organization") },
                { label: t("filters.date") },
                { label: t("filters.location") },
                { label: t("filters.category") },
                { label: t("events.status") },
                { label: t("common.actions"), align: "right" },
              ]}
            >
              {paginatedEvents.map((event) => {
                const isReported = isEventReported(event.id);
                const isHighlighted = highlightedEventId === event.id;
                return (
                  <TableRow
                    key={event.id}
                    id={`event-${event.id}`}
                    className={`cursor-pointer hover:bg-secondary/50 ${isHighlighted ? "bg-primary/10" : ""}`}
                    onClick={() => {
                      const newParams = new URLSearchParams(searchParams.toString());
                      newParams.set(QP.EVENT_ID, event.id.toString());
                      setSearchParams(newParams);
                    }}
                  >
                    <TableCell>
                      <div className="font-medium text-sm text-foreground">
                        {event.title}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm text-muted-foreground">
                        {event.organization}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">
                        {formatCardDate(event, i18n.language || "en-US")}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="block max-w-[150px] truncate text-sm text-muted-foreground">
                        {event.location}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-muted-foreground">
                        {event.category}
                      </span>
                    </TableCell>
                    <TableCell>
                      {isReported ? (
                        <AdminStatusBadge status="reported" />
                      ) : (
                        <AdminStatusBadge status="live" />
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={async (e) => {
                            e.stopPropagation();
                            await onEditEvent?.(event);
                          }}
                        >
                          {t("common.edit")}
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteConfirmId(event.id);
                          }}
                          className="hover:bg-error/10 hover:text-error"
                        >
                          {t("common.delete")}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </AdminTable>
          ) : (
            <AdminEmptyState
              icon={Calendar}
              title={t("admin.noEventsFound")}
              description={t("admin.noEventsMatchFilters")}
            />
          )}

          <EventDetailsModal
            event={selectedEvent}
            onClose={() => {
              const newParams = new URLSearchParams(searchParams.toString());
              newParams.delete(QP.EVENT_ID);
              setSearchParams(newParams);
            }}
            allEvents={events}
            hideSimilarEvents
          />

          {filteredEvents.length > 0 && (
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={setCurrentPage}
            />
          )}

          <AdminDeleteDialog
            isOpen={deleteConfirmId !== null}
            onClose={() => setDeleteConfirmId(null)}
            onConfirm={() => deleteConfirmId != null && handleDelete(deleteConfirmId)}
            title={t("events.deleteEventTitle")}
            description={t("events.deleteEventConfirm", {
              title: deleteConfirmId
                ? events.find((e) => e.id === deleteConfirmId)?.title || ""
                : "",
            })}
            isLoading={isDeleting}
          />
        </>
      ) : (
        <>
          <div className="flex gap-3">
            <AdminSearchBar
              value={submissionFilters.searchQuery}
              onChange={(value) => {
                submissionFilters.setSearchQuery(value);
                submissionPagination.setCurrentPage(1);
              }}
              placeholder={t("admin.searchSubmissions")}
            />
            <Select
              value={submissionFilters.statusFilter}
              onValueChange={(value) => {
                submissionFilters.setStatusFilter(value as "all" | SubmissionStatus);
                submissionPagination.setCurrentPage(1);
              }}
            >
              <SelectTrigger showIcon={false} className="h-11 w-[180px]">
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
            count={submissionFilters.filteredSubmissions.length}
            singularLabel={t("admin.submission")}
            pluralLabel={t("admin.submissions")}
          />

          {submissionFilters.filteredSubmissions.length > 0 ? (
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
              {submissionPagination.paginatedItems.map((submission) => (
                <TableRow
                  key={submission.id}
                  id={`submission-${submission.id}`}
                  className={`cursor-pointer hover:bg-secondary/50 ${submissionIdParam === submission.id ? "bg-primary/10" : ""}`}
                  onClick={() => {
                    const newParams = new URLSearchParams(searchParams.toString());
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
                      {getOrganizationName(submission.eventData.organization_id)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm text-muted-foreground">
                      {submission.submittedBy}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm text-muted-foreground">
                      {fmtTime(submission.submittedAt)}
                    </span>
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
                              submissionActions.handleApprove(submission);
                            }}
                            className="text-success hover:text-success hover:bg-success/10"
                          >
                            {t("admin.approve")}
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              submissionActions.handleRejectClick(submission);
                            }}
                            className="text-error hover:text-error hover:bg-error/10"
                          >
                            {t("admin.reject")}
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

          {submissionFilters.filteredSubmissions.length > 0 && (
            <Pagination
              currentPage={submissionPagination.currentPage}
              totalPages={submissionPagination.totalPages}
              onPageChange={submissionPagination.setCurrentPage}
            />
          )}

          <SubmissionDetailsDialog
            submission={selectedSubmission}
            organizationName={getOrganizationName(selectedSubmission?.eventData.organization_id)}
            isOpen={selectedSubmission !== null}
            onClose={() => {
              const newParams = new URLSearchParams(searchParams.toString());
              newParams.delete(QP.SUBMISSION_ID);
              setSearchParams(newParams);
            }}
            onApprove={submissionActions.handleApprove}
            onRejectClick={submissionActions.handleRejectClick}
            formatRelativeTime={fmtTime}
          />

          <RejectSubmissionDialog
            isOpen={submissionActions.rejectSubmissionId !== null}
            rejectionReason={submissionActions.rejectionReason}
            onClose={() => {
              submissionActions.setRejectSubmissionId(null);
              submissionActions.setRejectionReason("");
            }}
            onConfirm={() => {
              submissionActions.handleRejectConfirm(submissionIdParam);
            }}
            onRejectionReasonChange={submissionActions.setRejectionReason}
          />
        </>
      )}
    </div>
  );
}
