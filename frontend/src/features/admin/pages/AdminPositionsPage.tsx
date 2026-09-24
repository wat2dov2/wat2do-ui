import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getPositionsPage } from "@/features/positions/api/positions.api";
import { formatPositionDeadline } from "@/features/positions/lib/positionDates";
import { PositionDetailsDrawer } from "@/features/positions/components/PositionDetailsDrawer";
import { AdminPageHeader } from "@/features/admin/components/shared/AdminPageHeader";
import { AdminSearchBar } from "@/features/admin/components/shared/AdminSearchBar";
import { AdminTable } from "@/features/admin/components/shared/AdminTable";
import { PositionSubmissionReview } from "@/features/admin/components/PositionSubmissionReview";
import { getPositionSubmissions } from "@/features/admin/api/admin.api";
import { SUBMISSION_PENDING } from "@/shared/constants/statuses";
import { ADMIN_ITEMS_PER_PAGE } from "@/features/admin/constants";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import { queryKeys } from "@/shared/lib/queryKeys";
import { Stack } from "@/shared/layout";
import { Users } from "@/shared/ui/doodle-icons";
import { Button } from "@/shared/ui/button";
import { TableCell, TableRow } from "@/shared/ui/table";
import { LoadingPage } from "@/shared/ui/loading-page";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/shared/ui/tabs";
import type { Position } from "@/shared/types";

export function AdminPositionsPage({ onBack }: { onBack: () => void }) {
  const { t, i18n } = useTranslation();
  const { getSchoolTimezone } = useSchoolDirectory();
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedPosition, setSelectedPosition] = useState<Position | null>(null);
  const pendingSubmissions = useQuery({
    queryKey: queryKeys.positionSubmissions.list(1, SUBMISSION_PENDING),
    queryFn: () => getPositionSubmissions(1, SUBMISSION_PENDING),
  });
  const filters = { page, pageSize: ADMIN_ITEMS_PER_PAGE, search: submittedSearch, includeClosed: true, sortOrder: "desc" as const };
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: queryKeys.positions.list(filters),
    queryFn: () => getPositionsPage(filters),
  });

  return (
    <Tabs defaultValue="positions">
      <Stack gap={5}>
        <AdminPageHeader icon={Users} title={t("navigation.positions")} description={t("positions.searchPlaceholder")} onBack={onBack} />
        <TabsList>
          <TabsTrigger value="positions">{t("navigation.positions")}</TabsTrigger>
          <TabsTrigger value="submissions" count={pendingSubmissions.data?.total}>{t("positions.submissions")}</TabsTrigger>
        </TabsList>
        <TabsContent value="positions">
          <Stack gap={5}>
            <AdminSearchBar
              value={search} onChange={setSearch} placeholder={t("positions.searchPlaceholder")}
              onSubmit={() => { setSubmittedSearch(search.trim()); setPage(1); }}
              onClear={() => { setSearch(""); setSubmittedSearch(""); setPage(1); }}
              submitLabel={t("common.search")} clearLabel={t("positions.clearSearch")}
            />
            {isPending ? <LoadingPage /> : isError ? <Button onClick={() => void refetch()}>{t("common.tryAgain")}</Button> : (
              <AdminTable count={data.total} label={t("positions.position", { count: data.total })} pagination={{ currentPage: page, totalPages: data.total_pages, onPageChange: setPage }} headers={[{ label: t("navigation.positions") }, { label: t("navigation.clubs") }, { label: t("schools.school") }, { label: t("positions.deadlineLabel") }, { label: t("common.actions") }]}>
                {data.items.map((position) => (
                  <TableRow key={position.id}>
                    <TableCell>{position.title}</TableCell>
                    <TableCell>{position.club_name}</TableCell>
                    <TableCell>{position.school}</TableCell>
                    <TableCell>{formatPositionDeadline(position, i18n.language, getSchoolTimezone(position.school)) ?? "-"}</TableCell>
                    <TableCell><Button variant="outline" size="sm" onClick={() => setSelectedPosition(position)}>{t("common.view")}</Button></TableCell>
                  </TableRow>
                ))}
              </AdminTable>
            )}
            <PositionDetailsDrawer positions={data?.items ?? []} onSelect={setSelectedPosition} position={selectedPosition} onClose={() => setSelectedPosition(null)} />
          </Stack>
        </TabsContent>
        <TabsContent value="submissions">
          <PositionSubmissionReview />
        </TabsContent>
      </Stack>
    </Tabs>
  );
}
