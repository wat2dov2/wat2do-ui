import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Calendar, FileText } from "@/shared/ui/doodle-icons";
import { Button } from "@/shared/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/shared/ui/tabs";
import { Stack } from "@/shared/layout";
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
import { fetchEventFeed } from "@/features/events/api/events.api";
import { controlBox } from "@/shared/config/controlBox";
import { queryKeys } from "@/shared/lib/queryKeys";
import { useAdminEventsPage } from "@/features/admin/hooks/useAdminEventsPage";
import type { Event, SubmissionStatus } from "@/shared/types";
import { AdminPageHeader } from "@/features/admin/components/shared/AdminPageHeader";
import { AdminSearchBar } from "@/features/admin/components/shared/AdminSearchBar";
import { AdminEmptyState } from "@/features/admin/components/shared/AdminEmptyState";
import { LoadingState } from "@/shared/feedback";
import { AdminDeleteDialog } from "@/features/admin/components/shared/AdminDeleteDialog";
import { AdminTable } from "@/features/admin/components/shared/AdminTable";
import { ADMIN_ITEMS_PER_PAGE } from "@/features/admin/constants";
import { QP } from "@/shared/constants/queryParams";
import { formatCardDate } from "@/shared/utils/date";
import { useUIStore } from "@/shared/store/ui.store";

import { AdminEventReports } from "@/features/admin/components/AdminEventReports";
import { AdminStatusBadge } from "@/features/admin/components/shared/AdminStatusBadge";
import { SubmissionDetailsDrawer } from "@/features/admin/components/submissions/SubmissionDetailsDrawer";
import { RejectSubmissionDialog } from "@/features/admin/components/submissions/RejectSubmissionDialog";
import { useAdminStore } from "@/features/admin/store/admin.store";
import { useClubNameLookup } from "@/features/clubs";
import { useAdminSubmissionsFilters } from "@/features/admin/hooks/useAdminSubmissionsFilters";
import { AdminTableFilters } from "@/features/admin/components/shared/AdminTableFilters";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
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


interface AdminEventsPageProps {
  onBack: () => void;
}

export function AdminEventsPage({
  onBack,
}: AdminEventsPageProps) {
  const { t, i18n } = useTranslation();
  const [searchParams, setSearchParams] = useMutableSearchParams();

  const submissionIdParam = searchParams.get(QP.SUBMISSION_ID);
  const initialTab = submissionIdParam || searchParams.get("tab") === "submissions"
    ? "submissions" : searchParams.get("tab") === "reports" ? "reports" : "events";
  const [activeTab, setActiveTab] = useState<"events" | "submissions" | "reports">(initialTab);

  const deleteEvent = useEventsStore((s) => s.deleteEvent);
  const setEditingEvent = useUIStore((s) => s.setEditingEvent);
  const queryClient = useQueryClient();

  // Admin owns an all-school feed, independent of the public browse selection.
  const { data: events = [], isPending: isLoadingEvents } = useQuery({
    queryKey: queryKeys.events.admin(),
    queryFn: () => fetchEventFeed(undefined, { includePast: true }),
    staleTime: controlBox.clientCache.adminStaleMs,
  });

  const onEditEvent = (event: Event) => {
    setEditingEvent(event);
  };

  const {
    pendingReports,
    reportsLoading,
    reportsError,
    retryReports,
    searchQuery,
    selectedCategory,
    deleteConfirmId,
    currentPage,
    selectedEvent,
    categories,
    filteredEvents,
    paginatedEvents,
    totalPages,
    setSearchQuery,
    setSelectedCategory,
    selectEvent,
    clearSelectedEvent,
    setDeleteConfirmId,
    setCurrentPage,
  } = useAdminEventsPage({ events });

  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async (eventId: number) => {
    setIsDeleting(true);
    try {
      await Promise.resolve(deleteEvent(eventId));
      // The table reads the query, not the store the delete updates, so the
      // deleted row only leaves the page once the feed is refetched.
      await queryClient.invalidateQueries({
        queryKey: queryKeys.events.admin(),
      });
      setDeleteConfirmId(null);
    } finally {
      setIsDeleting(false);
    }
  };

  const fetchSubmissions = useAdminStore((s) => s.fetchSubmissions);
  const allSubmissions = useAdminStore((s) => s.submissions);

  useEffect(() => {
    fetchSubmissions().catch((err) =>
      console.error("Failed to fetch submissions:", err),
    );
  }, [fetchSubmissions]);

  const pendingSubmissionsCount = useMemo(() => {
    return allSubmissions.filter((s) => s.status === SUBMISSION_PENDING).length;
  }, [allSubmissions]);

  const { getClubName } = useClubNameLookup();
  const submissionFilters = useAdminSubmissionsFilters({ getClubName });
  const { getSchoolName } = useSchoolDirectory();
  const submissionPagination = usePagination({
    items: submissionFilters.filteredSubmissions,
    itemsPerPage: ADMIN_ITEMS_PER_PAGE,
  });
  const submissionActions = useAdminSubmissionsActions({
    onReviewed: (id) => {
      if (submissionIdParam !== id) return;
      const params = new URLSearchParams(searchParams.toString());
      params.delete(QP.SUBMISSION_ID);
      setSearchParams(params);
    },
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
    <Tabs
      value={activeTab}
      onValueChange={(value) => setActiveTab(value as "events" | "submissions" | "reports")}
    >
      <Stack gap={5}>
        <AdminPageHeader
          icon={Calendar}
          title={t("admin.manageEvents")}
          description={t("admin.manageEventsDesc")}
          onBack={onBack}
        />

        <TabsList>
          <TabsTrigger value="events">
            {t("admin.eventsList")}
          </TabsTrigger>
          <TabsTrigger value="submissions" count={pendingSubmissionsCount}>
            {t("admin.eventSubmissions")}
          </TabsTrigger>
          <TabsTrigger value="reports" count={pendingReports.length}>{t("admin.eventReports")}</TabsTrigger>
        </TabsList>

        <TabsContent value="events">
          <Stack gap={5}>
            <Stack direction="horizontal" gap={3}>
              <AdminSearchBar
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder={t("admin.searchEvents")}
              />
              <Select
                value={selectedCategory || undefined}
                onValueChange={(value) => setSelectedCategory(value || "")}
              >
                <SelectTrigger size="lg">
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
            </Stack>

            {filteredEvents.length > 0 ? (
              <AdminTable count={filteredEvents.length} label={filteredEvents.length === 1 ? t("common.event") : t("common.events")}
                pagination={{ currentPage, totalPages, onPageChange: setCurrentPage }}
                headers={[
                  { label: t("events.eventTitle") },
                  { label: t("events.club") },
                  { label: t("schools.school") },
                  { label: t("filters.date") },
                  { label: t("filters.location") },
                  { label: t("filters.category") },
                  { label: t("common.actions"), align: "right" },
                ]}
              >
                {paginatedEvents.map((event) => {
                  const isHighlighted = selectedEvent?.id === event.id;
                  return (
                    <TableRow
                      key={event.id}
                      id={`event-${event.id}`}
                      interactive
                      className={isHighlighted ? "bg-primary/10" : undefined}
                      onClick={() => selectEvent(event.id)}
                    >
                      <TableCell>
                        <div className="font-medium text-sm text-foreground">
                          {event.title}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm text-muted-foreground">
                          {event.club}
                        </div>
                      </TableCell>
                      <TableCell>{event.school}</TableCell>
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
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={async (e) => {
                              e.stopPropagation();
                              await onEditEvent?.(event);
                            }}
                          >
                            {t("common.edit")}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteConfirmId(event.id);
                            }}
                            className="hover:bg-surface-hover hover:text-destructive"
                          >
                            {t("common.delete")}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </AdminTable>
            ) : isLoadingEvents ? (
              // "No events found" is a claim about the data; say it only once the
              // feed has actually arrived.
              <LoadingState label={t("common.loading")} />
            ) : (
              <AdminEmptyState
                icon={Calendar}
                title={t("admin.noEventsFound")}
                description={t("admin.noEventsMatchFilters")}
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
          </Stack>
        </TabsContent>
        <TabsContent value="reports">
          <AdminEventReports reports={pendingReports} events={events} onViewEvent={selectEvent}
            isLoading={reportsLoading || isLoadingEvents} error={reportsError} onRetry={retryReports} />
        </TabsContent>
        <TabsContent value="submissions">
          <Stack gap={5}>
            <AdminTableFilters
                search={submissionFilters.searchQuery}
                school={submissionFilters.school}
                onSchoolChange={value => { submissionFilters.setSchool(value); submissionPagination.setCurrentPage(1); }}
                onSearchChange={(value) => {
                  submissionFilters.setSearchQuery(value);
                  submissionPagination.setCurrentPage(1);
                }}
              >
              <Select
                value={submissionFilters.statusFilter}
                onValueChange={(value) => {
                  submissionFilters.setStatusFilter(value as "all" | SubmissionStatus);
                  submissionPagination.setCurrentPage(1);
                }}
              >
                <SelectTrigger size="lg">
                  <SelectValue placeholder={t("admin.allStatus")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("admin.allStatus")}</SelectItem>
                  <SelectItem value={SUBMISSION_PENDING}>{t("admin.pending")}</SelectItem>
                  <SelectItem value={SUBMISSION_APPROVED}>{t("admin.approved")}</SelectItem>
                  <SelectItem value={SUBMISSION_REJECTED}>{t("admin.rejected")}</SelectItem>
                </SelectContent>
              </Select>
            </AdminTableFilters>

            {submissionFilters.filteredSubmissions.length > 0 ? (
              <AdminTable count={submissionFilters.filteredSubmissions.length} label={submissionFilters.filteredSubmissions.length === 1 ? t("admin.submission") : t("admin.submissions")}
                pagination={{ currentPage: submissionPagination.currentPage, totalPages: submissionPagination.totalPages, onPageChange: submissionPagination.setCurrentPage }}
                headers={[
                  { label: t("events.eventTitle") },
                  { label: t("events.club") },
                  { label: t("admin.submittedBy") },
                  { label: t("schools.school") },
                  { label: t("admin.submittedAt") },
                  { label: t("events.status") },
                  { label: t("common.actions"), align: "right" },
                ]}
              >
                {submissionPagination.paginatedItems.map((submission) => (
                  <TableRow
                    key={submission.id}
                    id={`submission-${submission.id}`}
                    interactive
                    className={submissionIdParam === submission.id ? "bg-primary/10" : undefined}
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
                        {getClubName(submission.eventData.club_id)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">
                        {submission.submittedBy}
                      </span>
                    </TableCell>
                    <TableCell>{submission.school ? getSchoolName(submission.school) : t("admin.unknown")}</TableCell>
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
                              variant="outline"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                submissionActions.handleApprove(submission);
                              }}
                              className="text-success hover:text-success hover:bg-surface-hover"
                            >
                              {t("admin.approve")}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                submissionActions.handleRejectClick(submission);
                              }}
                              className="text-destructive hover:text-destructive hover:bg-surface-hover"
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

            <SubmissionDetailsDrawer
              submission={selectedSubmission}
              clubName={getClubName(selectedSubmission?.eventData.club_id)}
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
                submissionActions.handleRejectConfirm();
              }}
              onRejectionReasonChange={submissionActions.setRejectionReason}
            />
          </Stack>
        </TabsContent>
        <EventDetailsModal event={selectedEvent} onClose={clearSelectedEvent} allEvents={events} hideSimilarEvents />
      </Stack>
    </Tabs>
  );
}
