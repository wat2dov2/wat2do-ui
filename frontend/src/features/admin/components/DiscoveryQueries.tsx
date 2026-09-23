import { useTranslation } from "react-i18next";
import { getDiscoveryQueries } from "@/features/admin/api/admin.api";
import { useAdminList } from "@/features/admin/hooks/useAdminList";
import { AdminTable } from "@/features/admin/components/shared/AdminTable";
import { AdminTableFilters } from "@/features/admin/components/shared/AdminTableFilters";
import { Stack } from "@/shared/layout";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import { Button } from "@/shared/ui/button";
import { LoadingPage } from "@/shared/ui/loading-page";
import { TableCell, TableRow } from "@/shared/ui/table";

export function DiscoveryQueries() {
  const { t, i18n } = useTranslation();
  const { getSchoolName } = useSchoolDirectory();
  const list = useAdminList("discovery-queries", getDiscoveryQueries);

  return (
    <Stack gap={5}>
      <AdminTableFilters
        search={list.filters.search ?? ""}
        onSearchChange={search => list.setFilters({ search })}
        school={list.filters.school ?? ""}
        onSchoolChange={school => list.setFilters({ school })}
      >
        <Button variant="outline" onClick={() => void list.refetch()}>
          {t("errorBoundary.refreshPage")}
        </Button>
      </AdminTableFilters>
      {list.isLoading ? <LoadingPage /> : list.isError ? (
        <Button onClick={() => void list.refetch()}>{t("common.tryAgain")}</Button>
      ) : (
        <AdminTable
          count={list.total}
          label={t("admin.diagnostics.queries.title")}
          pagination={list.pagination}
          headers={[
            { label: t("admin.timestamp") },
            { label: t("schools.school") },
            { label: t("admin.diagnostics.queries.surface") },
            { label: t("common.search") },
            { label: t("admin.diagnostics.queries.pageUrl") },
            { label: t("admin.diagnostics.queries.filters") },
          ]}
        >
          {list.items.length === 0 ? (
            <TableRow><TableCell colSpan={6}>{t("admin.diagnostics.queries.empty")}</TableCell></TableRow>
          ) : list.items.map(query => (
            <TableRow key={query.id}>
              <TableCell>{new Date(query.created_at).toLocaleString(i18n.language)}</TableCell>
              <TableCell>{getSchoolName(query.school)}</TableCell>
              <TableCell>{t(`navigation.${query.surface}`)}</TableCell>
              <TableCell variant="prose">{query.search_query || t("admin.diagnostics.queries.emptySearch")}</TableCell>
              <TableCell variant="prose">{query.page_url}</TableCell>
              <TableCell variant="prose"><code>{JSON.stringify(query.filters)}</code></TableCell>
            </TableRow>
          ))}
        </AdminTable>
      )}
    </Stack>
  );
}
