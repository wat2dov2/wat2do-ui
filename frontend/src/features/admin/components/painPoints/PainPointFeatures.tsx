import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Lightbulb } from "lucide-react";
import { getPainPointFeatures, type PainPointFeature } from "@/features/admin/api/admin.api";
import { Evidence } from "@/features/admin/components/painPoints/PainPointDailyReports";
import { AdminEmptyState } from "@/features/admin/components/shared/AdminEmptyState";
import { AdminTable } from "@/features/admin/components/shared/AdminTable";
import { AdminTableFilters } from "@/features/admin/components/shared/AdminTableFilters";
import { queryKeys } from "@/shared/lib/queryKeys";
import { Stack } from "@/shared/layout";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { ItemContent, ItemDescription, ItemTitle } from "@/shared/ui/item";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { TableCell, TableRow } from "@/shared/ui/table";

const DIMENSIONS = ["demand", "pain", "fit", "edge", "ease"] as const;
const SORTS = ["score", ...DIMENSIONS, "complaints", "newest"] as const;
const STATUSES = ["open", "built"] as const;

type Sort = (typeof SORTS)[number];

const SORT_VALUES: Record<Sort, (feature: PainPointFeature) => number | string> = {
  score: feature => feature.score,
  demand: feature => feature.demand,
  pain: feature => feature.pain,
  fit: feature => feature.fit,
  edge: feature => feature.edge,
  ease: feature => feature.ease,
  complaints: feature => feature.complaint_urls.length,
  newest: feature => feature.last_seen,
};

/** Out of 25: strong, worth a look, or weak. */
function scoreBadge(score: number) {
  return score >= 20 ? "success" : score >= 15 ? "warning" : "muted";
}

/** Every feature the daily reports have found worth building, with every complaint behind it, scored on five dimensions. */
export function PainPointFeatures() {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState<PainPointFeature["status"] | "">("open");
  const [sort, setSort] = useState<Sort>("score");
  const [search, setSearch] = useState("");
  const query = useQuery({
    queryKey: queryKeys.competitorPainPoints.features(status),
    queryFn: () => getPainPointFeatures(status),
  });
  const features = useMemo(() => {
    const value = SORT_VALUES[sort];
    const term = search.trim().toLowerCase();
    // The server lists them best score first, so ties keep that order.
    return (query.data ?? [])
      .filter(feature => !term || `${feature.title} ${feature.change} ${feature.problem}`.toLowerCase().includes(term))
      .sort((a, b) => (value(a) < value(b) ? 1 : value(a) > value(b) ? -1 : 0));
  }, [query.data, sort, search]);

  return (
    <Stack gap={5}>
      <p className="text-muted-foreground">{t("admin.painPoints.features.dimensionsHelp")}</p>
      <AdminTableFilters search={search} onSearchChange={setSearch}>
        <Select value={status || "all"} onValueChange={value => setStatus(value === "all" ? "" : value as PainPointFeature["status"])}>
          <SelectTrigger aria-label={t("admin.status")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("common.all")}</SelectItem>
            {STATUSES.map(value => <SelectItem key={value} value={value}>{t(`admin.painPoints.features.statuses.${value}`)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={value => setSort(value as Sort)}>
          <SelectTrigger aria-label={t("admin.painPoints.features.sortBy")}><SelectValue /></SelectTrigger>
          <SelectContent>
            {SORTS.map(value => <SelectItem key={value} value={value}>{t(`admin.painPoints.features.sorts.${value}`)}</SelectItem>)}
          </SelectContent>
        </Select>
      </AdminTableFilters>
      {query.isError ? <Button variant="outline" onClick={() => void query.refetch()}>{t("common.tryAgain")}</Button>
        : !query.isPending && features.length === 0 ? <AdminEmptyState icon={Lightbulb} title={t("admin.painPoints.features.emptyTitle")} description={t("admin.painPoints.features.emptyDescription")} />
        : <AdminTable isLoading={query.isPending} count={features.length} label={t("admin.painPoints.features.title")}
          headers={[
            { label: t("admin.painPoints.features.feature") },
            { label: t("admin.painPoints.features.score") },
            ...DIMENSIONS.map(dimension => ({ label: t(`admin.painPoints.features.dimensions.${dimension}`) })),
            { label: t("admin.painPoints.features.complaints") },
            { label: t("admin.painPoints.features.lastSeen") },
          ]}>
          {features.map(feature => <TableRow key={feature.id}>
            <TableCell variant="prose">
              <Stack gap={2} align="start">
                <ItemContent>
                  <ItemTitle>{feature.title}</ItemTitle>
                  <ItemDescription>{feature.change}</ItemDescription>
                </ItemContent>
                <Stack direction="horizontal" gap={1} wrap>
                  {feature.status === "built" && <Badge variant="success">{t("admin.painPoints.features.statuses.built")}</Badge>}
                  <Badge variant="muted">{t(`admin.painPoints.features.audiences.${feature.audience}`)}</Badge>
                  {feature.competitors.map(name => <Badge key={name} variant="muted">{name}</Badge>)}
                </Stack>
                <details>
                  <summary className="cursor-pointer">{t("admin.painPoints.features.details")}</summary>
                  <Stack gap={2} className="mt-2">
                    <p>{feature.problem}</p>
                    {feature.rationale && <p className="text-muted-foreground">{feature.rationale}</p>}
                    {feature.where.length > 0 && (
                      <p className="text-muted-foreground text-sm">
                        {t("admin.painPoints.reports.where")} {feature.where.map(place => <code key={place} className="me-2">{place}</code>)}
                      </p>
                    )}
                    <Evidence urls={feature.complaint_urls} />
                  </Stack>
                </details>
              </Stack>
            </TableCell>
            <TableCell><Badge variant={scoreBadge(feature.score)}>{feature.score}</Badge></TableCell>
            {DIMENSIONS.map(dimension => <TableCell key={dimension}>{feature[dimension]}</TableCell>)}
            <TableCell>{feature.complaint_urls.length}</TableCell>
            <TableCell>{new Date(`${feature.last_seen}T12:00:00`).toLocaleDateString(i18n.language)}</TableCell>
          </TableRow>)}
        </AdminTable>}
    </Stack>
  );
}
