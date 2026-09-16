import { useAdminList } from "@/features/admin/hooks/useAdminList";
import { getReportedEvents } from "@/features/admin/api/admin.api";
import { AdminTableFilters } from "./shared/AdminTableFilters";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import { useTranslation } from "react-i18next";
import { AdminTable } from "@/features/admin/components/shared/AdminTable";
import { AdminEmptyState } from "@/features/admin/components/shared/AdminEmptyState";
import { LoadingState } from "@/shared/feedback";
import { Stack } from "@/shared/layout/stack";
import { Button } from "@/shared/ui/button";
import { AlertTriangle } from "@/shared/ui/doodle-icons";
import { TableCell, TableRow } from "@/shared/ui/table";
import { formatRelativeTime } from "@/shared/utils/relativeTime";

export function AdminEventReports({ onViewEvent }: { onViewEvent: (eventId: number) => void }) {
  const { t, i18n } = useTranslation();
  const { getSchoolName, getSchoolTimezone } = useSchoolDirectory();
  const list = useAdminList("reports", getReportedEvents, true, { status: "pending" });
  return (
    <Stack gap={5}>
      <AdminTableFilters
        search={list.filters.search ?? ""}
        school={list.filters.school ?? ""}
        onSearchChange={search => list.setFilters({ search })}
        onSchoolChange={school => list.setFilters({ school })}
      />
      {list.isError ? (
        <Button variant="outline" onClick={() => void list.refetch()}>
          {t("common.tryAgain")}
        </Button>
      ) : list.isPending ? (
        <LoadingState label={t("common.loading")} />
      ) : list.total === 0 ? (
        <AdminEmptyState
          icon={AlertTriangle}
          title={t("admin.noPendingReports")}
          description={t("admin.noPendingReportsDesc")}
        />
      ) : (
        <AdminTable
          count={list.total}
          label={t(list.total === 1 ? "admin.eventReport" : "admin.eventReports")}
          pagination={list.pagination}
          headers={[
            { label: t("events.eventTitle") },
            { label: t("schools.school") },
            { label: t("admin.reportReason") },
            { label: t("admin.submittedAt") },
            { label: t("common.actions"), align: "right" },
          ]}
        >
          {list.items.map(report => (
            <TableRow key={report.id}>
              <TableCell>
                <Stack gap={1}>
                  <span>{report.eventTitle ?? `#${report.eventId}`}</span>
                  {!report.eventTitle ? <span>{t("admin.reportEventUnavailable")}</span> : null}
                </Stack>
              </TableCell>
              <TableCell>{report.school ? getSchoolName(report.school) : t("admin.unknown")}</TableCell>
              <TableCell variant="prose">{report.reason}</TableCell>
              <TableCell>{formatRelativeTime(report.reportedAt, t, { timeZone: getSchoolTimezone(report.school), locale: i18n.language })}</TableCell>
              <TableCell>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!report.eventTitle}
                  onClick={() => onViewEvent(report.eventId)}
                >
                  {t("common.view")}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </AdminTable>
      )}
    </Stack>
  );
}
