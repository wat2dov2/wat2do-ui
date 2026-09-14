import { useState } from "react";
import { AdminTableFilters } from "./shared/AdminTableFilters";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getPositionSubmissions } from "@/features/admin/api/admin.api";
import { AdminTable } from "@/features/admin/components/shared/AdminTable";
import { AdminStatusBadge } from "@/features/admin/components/shared/AdminStatusBadge";
import { AdminEmptyState } from "@/features/admin/components/shared/AdminEmptyState";
import { PositionSubmissionDrawer } from "@/features/admin/components/PositionSubmissionDrawer";
import { FileText } from "@/shared/ui/doodle-icons";
import { queryKeys } from "@/shared/lib/queryKeys";
import { Button } from "@/shared/ui/button";
import { LoadingPage } from "@/shared/ui/loading-page";
import { TableRow, TableCell } from "@/shared/ui/table";
import { Stack } from "@/shared/layout";
import type { ApiPositionSubmissionResponse } from "@/shared/generated";

export function PositionSubmissionReview() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [school, setSchool] = useState("");
  const [search, setSearch] = useState("");
  const { getSchoolName } = useSchoolDirectory();
  const [selected, setSelected] = useState<ApiPositionSubmissionResponse | null>(null);
  const query = useQuery({ queryKey: queryKeys.positionSubmissions.list(page, undefined, school, search), queryFn: () => getPositionSubmissions(page, undefined, school, search) });
  return (
    <Stack gap={5}>
      <AdminTableFilters search={search} school={school}
        onSearchChange={value => { setSearch(value); setPage(1); }}
        onSchoolChange={value => { setSchool(value); setPage(1); }} />
      {query.isPending ? <LoadingPage /> : query.isError ? <Button onClick={() => void query.refetch()}>{t("common.tryAgain")}</Button> : query.data.items.length === 0 ? <AdminEmptyState icon={FileText} title={t("admin.noSubmissionsFound")} description={t("admin.noSubmissionsMatchFilters")} /> : (
        <AdminTable count={query.data.total} label={query.data.total === 1 ? t("admin.submission") : t("admin.submissions")} pagination={{ currentPage: page, totalPages: query.data.total_pages, onPageChange: setPage }} headers={[{ label: t("positions.title") }, { label: t("schools.school") }, { label: t("admin.status") }, { label: t("common.actions") }]}>
          {query.data.items.map(item => <TableRow key={item.id}><TableCell>{item.position_data.title}</TableCell><TableCell>{item.school ? getSchoolName(item.school) : t("admin.unknown")}</TableCell><TableCell><AdminStatusBadge status={item.status} /></TableCell><TableCell><Button variant="outline" onClick={() => setSelected(item)}>{t("common.view")}</Button></TableCell></TableRow>)}
        </AdminTable>
      )}
      {selected && <PositionSubmissionDrawer key={selected.id} submission={selected} onClose={() => setSelected(null)} />}
    </Stack>
  );
}
