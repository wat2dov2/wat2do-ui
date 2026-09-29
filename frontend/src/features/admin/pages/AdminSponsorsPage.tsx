import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getSponsorSubmissions, type SponsorSubmission } from "@/features/admin/api/admin.api";
import { SponsorSubmissionDrawer } from "@/features/admin/components/SponsorSubmissionDrawer";
import { AdminPageHeader } from "@/features/admin/components/shared/AdminPageHeader";
import { AdminTable } from "@/features/admin/components/shared/AdminTable";
import { AdminTableFilters } from "@/features/admin/components/shared/AdminTableFilters";
import { AdminStatusBadge } from "@/features/admin/components/shared/AdminStatusBadge";
import { AdminEmptyState } from "@/features/admin/components/shared/AdminEmptyState";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import { queryKeys } from "@/shared/lib/queryKeys";
import { Button } from "@/shared/ui/button";
import { Building2 } from "@/shared/ui/doodle-icons";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { TableCell, TableRow } from "@/shared/ui/table";
import { Stack } from "@/shared/layout";

export function AdminSponsorsPage({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const { getSchoolName } = useSchoolDirectory();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("pending");
  const [school, setSchool] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<SponsorSubmission | null>(null);
  const query = useQuery({
    queryKey: queryKeys.sponsorSubmissions.list(page, status, school, search),
    queryFn: () => getSponsorSubmissions(page, status, school, search),
  });
  return (
    <Stack gap={5}>
      <AdminPageHeader icon={Building2} title={t("admin.sponsors.title")} description={t("admin.sponsors.description")} onBack={onBack} />
      <AdminTableFilters search={search} school={school}
        onSearchChange={value => { setSearch(value); setPage(1); }}
        onSchoolChange={value => { setSchool(value); setPage(1); }}>
        <Select value={status || "all"} onValueChange={value => { setStatus(value === "all" ? "" : value); setPage(1); }}>
          <SelectTrigger aria-label={t("admin.status")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("common.all")}</SelectItem>
            {(["pending", "approved", "rejected"] as const).map(value => <SelectItem key={value} value={value}>{t(`admin.${value}`)}</SelectItem>)}
          </SelectContent>
        </Select>
      </AdminTableFilters>
      {query.isError ? <Button variant="outline" onClick={() => void query.refetch()}>{t("common.tryAgain")}</Button>
        : !query.isPending && query.data?.items.length === 0 ? <AdminEmptyState icon={Building2} title={t("admin.noSubmissionsFound")} description={t("admin.noSubmissionsMatchFilters")} />
        : <AdminTable isLoading={query.isPending} count={query.data?.total ?? 0} label={t("admin.sponsors.submissions")}
          pagination={{ currentPage: page, totalPages: query.data?.total_pages ?? 1, onPageChange: setPage }}
          headers={[{ label: t("contact.businessSupport.fields.businessName.label") }, { label: t("schools.school") }, { label: t("admin.status") }, { label: t("common.actions") }]}>
          {query.data?.items.map(item => <TableRow key={item.id}>
            <TableCell>{item.business_name}</TableCell>
            <TableCell>{getSchoolName(item.school)}</TableCell>
            <TableCell><AdminStatusBadge status={item.status} /></TableCell>
            <TableCell><Button variant="outline" onClick={() => setSelected(item)}>{t("common.view")}</Button></TableCell>
          </TableRow>)}
        </AdminTable>}
      {selected && <SponsorSubmissionDrawer submission={selected} onClose={() => setSelected(null)} />}
    </Stack>
  );
}
