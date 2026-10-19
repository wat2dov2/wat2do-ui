import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  getCompetitorPainPoints,
  reviewCompetitorPainPoint,
  type CompetitorPainPoint,
  type CompetitorPainPointFilters,
} from "@/features/admin/api/admin.api";
import { AdminPageHeader } from "@/features/admin/components/shared/AdminPageHeader";
import { AdminTable } from "@/features/admin/components/shared/AdminTable";
import { AdminTableFilters } from "@/features/admin/components/shared/AdminTableFilters";
import { AdminEmptyState } from "@/features/admin/components/shared/AdminEmptyState";
import { queryKeys } from "@/shared/lib/queryKeys";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { ExternalLink, MessageCircle } from "@/shared/ui/doodle-icons";
import { ItemContent, ItemDescription, ItemTitle } from "@/shared/ui/item";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { TableCell, TableRow } from "@/shared/ui/table";
import { Stack } from "@/shared/layout";
import painPoints from "../../../../../backend/controlbox/competitor_pain_points.json" with { type: "json" };

const AUDIENCES = ["organizer", "attendee", "other"] as const;
const STATUSES = ["new", "seen", "dismissed"] as const;

/** Complaints the Mac's Haiku sweep found about competitors; admins only read and triage them. */
export function AdminCompetitorPainPointsPage({ onBack }: { onBack: () => void }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<CompetitorPainPointFilters>({ competitor: "", source: "", audience: "", status: "new", search: "" });
  const query = useQuery({
    queryKey: queryKeys.competitorPainPoints.list(page, filters),
    queryFn: () => getCompetitorPainPoints(page, filters),
  });
  const review = useMutation({
    mutationFn: ({ id, status }: { id: string; status: CompetitorPainPoint["status"] }) => reviewCompetitorPainPoint(id, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.competitorPainPoints.all }),
  });
  const filter = (key: keyof CompetitorPainPointFilters) => (value: string) => {
    setFilters(current => ({ ...current, [key]: value === "all" ? "" : value }));
    setPage(1);
  };
  const choices: { key: keyof CompetitorPainPointFilters; label: string; options: { value: string; label: string }[] }[] = [
    { key: "competitor", label: t("admin.painPoints.competitor"), options: Object.entries(painPoints.competitors).map(([value, label]) => ({ value, label })) },
    { key: "source", label: t("admin.painPoints.source"), options: Object.keys(painPoints.sources).map(value => ({ value, label: t(`admin.painPoints.sources.${value}`) })) },
    { key: "audience", label: t("admin.painPoints.audience"), options: AUDIENCES.map(value => ({ value, label: t(`admin.painPoints.audiences.${value}`) })) },
    { key: "status", label: t("admin.status"), options: STATUSES.map(value => ({ value, label: t(`admin.painPoints.statuses.${value}`) })) },
  ];

  return (
    <Stack gap={5}>
      <AdminPageHeader icon={MessageCircle} title={t("admin.painPoints.title")} description={t("admin.painPoints.description")} onBack={onBack} />
      <AdminTableFilters search={filters.search} onSearchChange={filter("search")}>
        {choices.map(choice => (
          <Select key={choice.key} value={filters[choice.key] || "all"} onValueChange={filter(choice.key)}>
            <SelectTrigger aria-label={choice.label}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("common.all")}</SelectItem>
              {choice.options.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
            </SelectContent>
          </Select>
        ))}
      </AdminTableFilters>
      {query.isError ? <Button variant="outline" onClick={() => void query.refetch()}>{t("common.tryAgain")}</Button>
        : !query.isPending && query.data?.items.length === 0 ? <AdminEmptyState icon={MessageCircle} title={t("admin.painPoints.emptyTitle")} description={t("admin.painPoints.emptyDescription")} />
        : <AdminTable isLoading={query.isPending} count={query.data?.total ?? 0} label={t("admin.painPoints.title")}
          pagination={{ currentPage: page, totalPages: query.data?.total_pages ?? 1, onPageChange: setPage }}
          headers={[{ label: t("admin.painPoints.complaint") }, { label: t("admin.painPoints.competitor") }, { label: t("admin.painPoints.audience") }, { label: t("admin.painPoints.posted") }, { label: t("common.actions") }]}>
          {query.data?.items.map(item => <TableRow key={item.id}>
            <TableCell>
              <ItemContent>
                <ItemTitle>{item.pain_point}</ItemTitle>
                <ItemDescription>{item.author ? `${item.author}: ` : ""}“{item.quote}”</ItemDescription>
              </ItemContent>
            </TableCell>
            <TableCell>
              <Stack gap={1} align="start">
                <span>{painPoints.competitors[item.competitor as keyof typeof painPoints.competitors] ?? item.competitor}</span>
                <Badge variant="muted">{t(`admin.painPoints.sources.${item.source}`, { defaultValue: item.source })}</Badge>
              </Stack>
            </TableCell>
            <TableCell><Badge variant={item.audience === "organizer" ? "success" : item.audience === "attendee" ? "warning" : "muted"}>{t(`admin.painPoints.audiences.${item.audience}`)}</Badge></TableCell>
            <TableCell>{new Date(item.posted_at ?? item.found_at).toLocaleDateString(i18n.language)}</TableCell>
            <TableCell>
              <Stack direction="horizontal" gap={2}>
                <Button asChild variant="outline" size="icon-sm" aria-label={t("admin.painPoints.open")}>
                  <a href={item.url} target="_blank" rel="noopener noreferrer"><ExternalLink /></a>
                </Button>
                {item.status === "new" && <Button variant="outline" disabled={review.isPending} onClick={() => review.mutate({ id: item.id, status: "seen" })}>{t("admin.painPoints.markSeen")}</Button>}
                {item.status !== "dismissed" && <Button variant="ghost" disabled={review.isPending} onClick={() => review.mutate({ id: item.id, status: "dismissed" })}>{t("admin.painPoints.dismiss")}</Button>}
              </Stack>
            </TableCell>
          </TableRow>)}
        </AdminTable>}
    </Stack>
  );
}
