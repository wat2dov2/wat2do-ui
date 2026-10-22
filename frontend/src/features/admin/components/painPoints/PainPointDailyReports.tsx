import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getCompetitorPainPointReports, type CompetitorPainPointReport } from "@/features/admin/api/admin.api";
import { AdminEmptyState } from "@/features/admin/components/shared/AdminEmptyState";
import { queryKeys } from "@/shared/lib/queryKeys";
import { Stack } from "@/shared/layout";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { FileText } from "@/shared/ui/doodle-icons";
import { Pagination } from "@/shared/ui/Pagination";
import { Skeleton } from "@/shared/ui/skeleton";

const PRIORITY_BADGES = { high: "destructive", medium: "warning", low: "muted" } as const;

/** One card per day: what Opus made of that day's complaints and the changes it suggests for wat2do.io. */
export function PainPointDailyReports() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: queryKeys.competitorPainPoints.reports(page),
    queryFn: () => getCompetitorPainPointReports(page),
  });

  if (query.isError) return <Button variant="outline" onClick={() => void query.refetch()}>{t("common.tryAgain")}</Button>;
  if (query.isPending) return <Skeleton className="h-64 w-full" />;
  if (query.data.items.length === 0) {
    return <AdminEmptyState icon={FileText} title={t("admin.painPoints.reports.emptyTitle")} description={t("admin.painPoints.reports.emptyDescription")} />;
  }
  return (
    <Stack gap={5}>
      {query.data.items.map(report => <DailyReportCard key={report.id} report={report} />)}
      {query.data.total_pages > 1 && <Pagination currentPage={page} totalPages={query.data.total_pages} onPageChange={setPage} />}
    </Stack>
  );
}

function DailyReportCard({ report }: { report: CompetitorPainPointReport }) {
  const { t, i18n } = useTranslation();
  // report_date is a calendar day; read it at noon so no time zone moves it.
  const day = new Date(`${report.report_date}T12:00:00`).toLocaleDateString(i18n.language, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{day}</CardTitle>
        <CardDescription>{t("admin.painPoints.reports.meta", { count: report.complaint_count, model: report.model })}</CardDescription>
      </CardHeader>
      <CardContent>
        <Stack gap={5}>
          <p>{report.summary}</p>
          {report.suggestions.length > 0 && (
            <Stack gap={3}>
              <h3 className="font-semibold">{t("admin.painPoints.reports.suggestions")}</h3>
              <ol className="flex list-decimal flex-col gap-4 ps-5">
                {report.suggestions.map(suggestion => (
                  <li key={suggestion.title}>
                    <Stack gap={1}>
                      <Stack direction="horizontal" gap={2} align="center" wrap>
                        <span className="font-semibold">{suggestion.title}</span>
                        <Badge variant={PRIORITY_BADGES[suggestion.priority]}>{t(`admin.painPoints.reports.priorities.${suggestion.priority}`)}</Badge>
                      </Stack>
                      <p className="text-muted-foreground">{suggestion.problem}</p>
                      <p>{suggestion.change}</p>
                      {(suggestion.where ?? []).length > 0 && (
                        <p className="text-muted-foreground text-sm">
                          {t("admin.painPoints.reports.where")} {(suggestion.where ?? []).map(place => <code key={place} className="me-2">{place}</code>)}
                        </p>
                      )}
                      <Evidence urls={suggestion.complaint_urls ?? []} />
                    </Stack>
                  </li>
                ))}
              </ol>
            </Stack>
          )}
          {report.themes.length > 0 && (
            <details>
              <summary className="cursor-pointer font-semibold">{t("admin.painPoints.reports.themes", { count: report.themes.length })}</summary>
              <ul className="mt-3 flex flex-col gap-3">
                {report.themes.map(theme => (
                  <li key={theme.theme}>
                    <Stack gap={1}>
                      <span className="font-semibold">{theme.theme}</span>
                      <p className="text-muted-foreground">{theme.detail}</p>
                      {(theme.competitors ?? []).length > 0 && (
                        <Stack direction="horizontal" gap={1} wrap>
                          {(theme.competitors ?? []).map(name => <Badge key={name} variant="muted">{name}</Badge>)}
                        </Stack>
                      )}
                      <Evidence urls={theme.complaint_urls ?? []} />
                    </Stack>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}

/** Numbered links to the complaints a theme or suggestion rests on. */
function Evidence({ urls }: { urls: string[] }) {
  const { t } = useTranslation();
  if (urls.length === 0) return null;
  return (
    <p className="text-sm">
      {t("admin.painPoints.reports.evidence")}{" "}
      {urls.map((url, index) => (
        <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="me-2 underline">
          {index + 1}
        </a>
      ))}
    </p>
  );
}
