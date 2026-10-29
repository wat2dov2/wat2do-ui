import { useTranslation } from "react-i18next";
import { UserPlus } from "lucide-react";
import { useFollowCandidates } from "@/features/admin/hooks/useFollowCandidates";
import { FOLLOW_CANDIDATE_STATUSES } from "@/features/admin/lib/followCandidates";
import { AdminEmptyState } from "@/features/admin/components/shared/AdminEmptyState";
import { FollowCandidateCard } from "@/features/admin/components/social/FollowCandidateCard";
import { FormGrid, Stack } from "@/shared/layout";
import { FilterBar } from "@/shared/layout/filter-bar";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import { Button } from "@/shared/ui/button";
import { Pagination } from "@/shared/ui/Pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { Skeleton } from "@/shared/ui/skeleton";

const ALL_SCHOOLS = "all";

/** Accounts found for each school account to follow; decisions stay on the page until submitted. */
export function FollowCandidatesPanel() {
  const { t } = useTranslation();
  const { schools, getSchoolName } = useSchoolDirectory();
  const view = useFollowCandidates();

  return (
    <Stack gap={4}>
      <FilterBar
        trailing={
          <Button type="button" disabled={!view.pendingCount || view.submit.isPending} onClick={() => view.submit.mutate()}>
            {t("admin.followCandidates.submit", { value: view.pendingCount })}
          </Button>
        }
      >
        <Select value={view.school || ALL_SCHOOLS} onValueChange={(value) => view.setSchool(value === ALL_SCHOOLS ? "" : value)}>
          <SelectTrigger aria-label={t("admin.followCandidates.schoolLabel")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_SCHOOLS}>{t("admin.followCandidates.allSchools")}</SelectItem>
            {schools.map((school) => <SelectItem key={school.slug} value={school.slug}>{school.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={view.status} onValueChange={(value) => view.setStatus(value as typeof view.status)}>
          <SelectTrigger aria-label={t("admin.followCandidates.statusLabel")}><SelectValue /></SelectTrigger>
          <SelectContent>
            {FOLLOW_CANDIDATE_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>{t(`admin.followCandidates.statuses.${status}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FilterBar>
      {view.submit.isError ? <p className="text-sm text-destructive">{t("admin.followCandidates.submitFailed")}</p> : null}
      {view.query.isError ? (
        <Button variant="outline" onClick={() => void view.query.refetch()}>{t("common.tryAgain")}</Button>
      ) : view.query.isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : view.candidates.length ? (
        <>
          <p className="text-sm text-muted-foreground">{t("admin.followCandidates.total", { value: view.total })}</p>
          <FormGrid columns="gallery" className="items-stretch">
            {view.candidates.map((candidate) => (
              <FollowCandidateCard
                key={candidate.id}
                candidate={candidate}
                schoolName={getSchoolName(candidate.school)}
                decision={view.decisionFor(candidate)}
                onDecide={candidate.status === "pending" ? (decision) => view.decide(candidate, decision) : undefined}
              />
            ))}
          </FormGrid>
          {view.totalPages > 1 ? <Pagination currentPage={view.page} totalPages={view.totalPages} onPageChange={view.setPage} /> : null}
        </>
      ) : (
        <AdminEmptyState
          icon={UserPlus}
          title={t("admin.followCandidates.emptyTitle")}
          description={t("admin.followCandidates.emptyDescription")}
        />
      )}
    </Stack>
  );
}
