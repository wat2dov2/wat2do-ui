import { useMemo, useState } from "react";
import { AdminTableFilters } from "./shared/AdminTableFilters";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import { useTranslation } from "react-i18next";
import { AdminTable } from "@/features/admin/components/shared/AdminTable";
import { AdminEmptyState } from "@/features/admin/components/shared/AdminEmptyState";
import { ADMIN_ITEMS_PER_PAGE } from "@/features/admin/constants";
import { usePagination } from "@/shared/hooks";
import { LoadingState } from "@/shared/feedback";
import { Stack } from "@/shared/layout/stack";
import { Button } from "@/shared/ui/button";
import { AlertTriangle } from "@/shared/ui/doodle-icons";
import { TableCell, TableRow } from "@/shared/ui/table";
import { formatRelativeTime } from "@/shared/utils/relativeTime";
import type { Event, ReportedEvent } from "@/shared/types";

interface AdminEventReportsProps {
  reports: ReportedEvent[];
  events: Event[];
  isLoading: boolean;
  error: boolean;
  onRetry: () => void;
  onViewEvent: (eventId: number) => void;
}

export function AdminEventReports({ reports, events, isLoading, error, onRetry, onViewEvent }: AdminEventReportsProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [school, setSchool] = useState("");
  const { getSchoolName } = useSchoolDirectory();
  const eventsById = useMemo(() => new Map(events.map(event => [event.id, event])), [events]);
  const filteredReports = useMemo(() => reports.filter(report => {
    const event = eventsById.get(report.eventId);
    return (!school || report.school === school)
      && `${event?.title ?? ""} ${report.reason} ${report.eventId}`.toLowerCase().includes(search.trim().toLowerCase());
  }), [reports, eventsById, school, search]);
  const pagination = usePagination({ items: filteredReports, itemsPerPage: ADMIN_ITEMS_PER_PAGE });

  if (error) return <Button variant="outline" onClick={onRetry}>{t("common.tryAgain")}</Button>;
  if (isLoading) return <LoadingState label={t("common.loading")} />;
  return (
    <Stack gap={5}>
      <AdminTableFilters search={search} school={school}
        onSearchChange={value => { setSearch(value); pagination.setCurrentPage(1); }}
        onSchoolChange={value => { setSchool(value); pagination.setCurrentPage(1); }} />
      {filteredReports.length === 0 ? <AdminEmptyState icon={AlertTriangle} title={t("admin.noPendingReports")} description={t("admin.noPendingReportsDesc")} /> :
    <AdminTable count={filteredReports.length} label={t(filteredReports.length === 1 ? "admin.eventReport" : "admin.eventReports")}
      pagination={{ currentPage: pagination.currentPage, totalPages: pagination.totalPages, onPageChange: pagination.setCurrentPage }}
      headers={[
        { label: t("events.eventTitle") },
        { label: t("schools.school") },
        { label: t("admin.reportReason") },
        { label: t("admin.submittedAt") },
        { label: t("common.actions"), align: "right" },
      ]}>
      {pagination.paginatedItems.map(report => {
        const event = eventsById.get(report.eventId);
        return (
          <TableRow key={report.id}>
            <TableCell>
              <Stack gap={1}>
                <span>{event?.title ?? `#${report.eventId}`}</span>
                {!event ? <span>{t("admin.reportEventUnavailable")}</span> : null}
              </Stack>
            </TableCell>
            <TableCell>{report.school ? getSchoolName(report.school) : t("admin.unknown")}</TableCell>
            <TableCell variant="prose">{report.reason}</TableCell>
            <TableCell>{formatRelativeTime(report.reportedAt, t)}</TableCell>
            <TableCell>
              <Button variant="outline" size="sm" disabled={!event} onClick={() => onViewEvent(report.eventId)}>
                {t("common.view")}
              </Button>
            </TableCell>
          </TableRow>
        );
      })}
    </AdminTable>}
    </Stack>
  );
}
