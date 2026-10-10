import { useTranslation } from "react-i18next";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import type { components } from "@/shared/generated/api-types";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import {
  INGESTION_LATENCY_WINDOWS,
  useIngestionLatency,
  type IngestionLatencyWindow,
} from "@/features/admin/hooks/useIngestionLatency";
import { FormGrid, Section, Stack } from "@/shared/layout";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/shared/ui/chart";
import { Item, ItemContent, ItemDescription, ItemTitle } from "@/shared/ui/item";
import { LoadingPage } from "@/shared/ui/loading-page";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/ui/table";

type IngestionLatencyReport = components["schemas"]["IngestionLatencyResponse"];
type LatencyStats = components["schemas"]["LatencyStats"];

const WINDOW_LABEL_KEYS: Record<IngestionLatencyWindow, string> = {
  1: "admin.diagnostics.latency.last24Hours",
  7: "qrCode.last7Days",
  30: "admin.last30Days",
};

/** Minutes under an hour read as "42 min"; longer delays as "3.1 hr". */
function formatMinutes(minutes: number | null, language: string) {
  if (minutes === null) return "-";
  const inHours = minutes >= 60;
  return new Intl.NumberFormat(language, {
    style: "unit",
    unit: inHours ? "hour" : "minute",
    unitDisplay: "short",
    maximumFractionDigits: inHours ? 1 : 0,
  }).format(inHours ? minutes / 60 : minutes);
}

export function IngestionLatency() {
  const { t } = useTranslation();
  const { data, isLoading, isError, days, setDays } = useIngestionLatency();
  const hasCatches = Boolean(data && data.new_events.count + data.updates.count > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle><h2>{t("admin.diagnostics.latency.title")}</h2></CardTitle>
        <CardDescription>{t("admin.diagnostics.latency.description")}</CardDescription>
        <CardAction>
          <Select value={String(days)} onValueChange={value => setDays(Number(value) as IngestionLatencyWindow)}>
            <SelectTrigger aria-label={t("admin.diagnostics.latency.rangeLabel")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INGESTION_LATENCY_WINDOWS.map(window => (
                <SelectItem key={window} value={String(window)}>{t(WINDOW_LABEL_KEYS[window])}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardAction>
      </CardHeader>
      <CardContent>
        {isLoading ? <LoadingPage /> : isError || !data ? <p>{t("admin.diagnostics.latency.error")}</p> : hasCatches ? (
          <LatencyReport report={data} />
        ) : <p>{t("admin.diagnostics.latency.empty")}</p>}
      </CardContent>
    </Card>
  );
}

function LatencyReport({ report }: { report: IngestionLatencyReport }) {
  const { t, i18n } = useTranslation();
  const { getSchoolName } = useSchoolDirectory();
  const format = (minutes: number | null) => formatMinutes(minutes, i18n.language);
  const statCells = (stats: LatencyStats) => [
    <TableCell key="count">{stats.count.toLocaleString(i18n.language)}</TableCell>,
    <TableCell key="mean">{format(stats.mean_minutes)}</TableCell>,
    <TableCell key="median">{format(stats.median_minutes)}</TableCell>,
  ];

  return (
    <Stack gap={6}>
      <FormGrid columns={2}>
        <LatencySummary
          title={t("admin.diagnostics.latency.newEvents")}
          description={t("admin.diagnostics.latency.newEventsDescription")}
          stats={report.new_events}
        />
        <LatencySummary
          title={t("admin.diagnostics.latency.updates")}
          description={t("admin.diagnostics.latency.updatesDescription")}
          stats={report.updates}
        />
      </FormGrid>
      <HourlyLatencyChart hourly={report.hourly} />
      <Table>
        <TableHeader><TableRow>
          <TableHead>{t("schools.school")}</TableHead>
          <TableHead>{t("admin.diagnostics.latency.newEvents")}</TableHead>
          <TableHead>{t("admin.diagnostics.latency.newMean")}</TableHead>
          <TableHead>{t("admin.diagnostics.latency.newMedian")}</TableHead>
          <TableHead>{t("admin.diagnostics.latency.updates")}</TableHead>
          <TableHead>{t("admin.diagnostics.latency.updateMean")}</TableHead>
          <TableHead>{t("admin.diagnostics.latency.updateMedian")}</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {report.schools.map(row => (
            <TableRow key={row.school}>
              <TableCell>{getSchoolName(row.school)}</TableCell>
              {statCells(row.new_events)}
              {statCells(row.updates)}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Stack>
  );
}

function LatencySummary({ title, description, stats }: { title: string; description: string; stats: LatencyStats }) {
  const { t, i18n } = useTranslation();
  const values = [
    { label: t("admin.diagnostics.latency.count"), value: stats.count.toLocaleString(i18n.language) },
    { label: t("admin.diagnostics.latency.mean"), value: formatMinutes(stats.mean_minutes, i18n.language) },
    { label: t("admin.diagnostics.latency.median"), value: formatMinutes(stats.median_minutes, i18n.language) },
  ];
  return (
    <Section title={title} description={description}>
      <FormGrid columns={3} collapse={false}>
        {values.map(({ label, value }) => (
          <Item key={label} variant="outline" size="sm">
            <ItemContent>
              <ItemDescription>{label}</ItemDescription>
              <ItemTitle>{value}</ItemTitle>
            </ItemContent>
          </Item>
        ))}
      </FormGrid>
    </Section>
  );
}

function HourlyLatencyChart({ hourly }: { hourly: IngestionLatencyReport["hourly"] }) {
  const { t, i18n } = useTranslation();
  const config = {
    mean: { label: t("admin.diagnostics.latency.meanMinutes"), color: "var(--primary)" },
    median: { label: t("admin.diagnostics.latency.medianMinutes"), color: "var(--muted-foreground)" },
  } satisfies ChartConfig;
  const hourLabel = new Intl.DateTimeFormat(i18n.language, { month: "short", day: "numeric", hour: "numeric" });
  const data = hourly.map(bucket => ({
    hour: hourLabel.format(new Date(bucket.hour)),
    mean: Math.round(bucket.mean_minutes * 10) / 10,
    median: Math.round(bucket.median_minutes * 10) / 10,
  }));

  return (
    <Section
      title={t("admin.diagnostics.latency.hourlyTitle")}
      description={t("admin.diagnostics.latency.hourlyDescription")}
    >
      <ChartContainer config={config} aspect="wide">
        <LineChart data={data} margin={{ left: 12, right: 12 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="hour" tickLine={false} axisLine={false} tickMargin={8} minTickGap={32} />
          <YAxis tickLine={false} axisLine={false} width={40} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Line dataKey="mean" type="monotone" stroke="var(--color-mean)" strokeWidth={2} dot={false} />
          <Line dataKey="median" type="monotone" stroke="var(--color-median)" strokeWidth={2} strokeDasharray="4 4" dot={false} />
        </LineChart>
      </ChartContainer>
    </Section>
  );
}
