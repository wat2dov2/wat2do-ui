import { useTranslation } from "react-i18next";
import { formatInTimeZone } from "date-fns-tz";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import { useAutomateLogs } from "@/features/admin/api/automateLogsApi";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/shared/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/shared/ui/table";
import { LoadingPage } from "@/shared/ui/loading-page";

export function DiagnosticsLogs({ browserWorker = false }: { browserWorker?: boolean }) {
  const { t } = useTranslation();
  const { getSchoolTimezone } = useSchoolDirectory();
  const { data: logs = [], isLoading, isError } = useAutomateLogs(browserWorker ? "instagram-browser-worker" : undefined);
  const namespace = browserWorker ? "admin.diagnostics.browserLogs" : "admin.diagnostics.automateLogs";
  return (
    <Card>
      <CardHeader>
        <CardTitle><h2>{t(`${namespace}.title`)}</h2></CardTitle>
        <CardDescription>{t(`${namespace}.description`)}</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? <LoadingPage /> : isError ? <p>{t("admin.diagnostics.browserLogs.error")}</p> : (
          <Table>
            <TableHeader><TableRow>
              <TableHead>{t("admin.diagnostics.browserLogs.time")}</TableHead>
              <TableHead>{t("admin.diagnostics.browserLogs.event")}</TableHead>
              <TableHead>{t("admin.diagnostics.browserLogs.school")}</TableHead>
              <TableHead>{t("admin.diagnostics.browserLogs.details")}</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {logs.length === 0 ? <TableRow><TableCell colSpan={4}>{t(`${namespace}.placeholder`)}</TableCell></TableRow> : logs.map(log => (
                <TableRow key={log.id}>
                  <TableCell>{formatInTimeZone(typeof log.payload?.recorded_at === "number" ? new Date(log.payload.recorded_at * 1000) : log.created_at, getSchoolTimezone(log.school), "MM-dd HH:mm:ss zzz")}</TableCell>
                  <TableCell variant="prose">{log.event}</TableCell>
                  <TableCell>{log.school}{log.ig_account ? ` (@${log.ig_account})` : ""}</TableCell>
                  <TableCell variant="prose">{[log.post_url, log.payload?.job_id, log.payload?.reason].filter(value => typeof value === "string").join(" | ")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
