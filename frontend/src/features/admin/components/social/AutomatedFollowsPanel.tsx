import { useTranslation } from "react-i18next";
import { CalendarDays, ChevronLeft, ChevronRight, UserPlus } from "lucide-react";
import { useAutomatedFollows } from "@/features/admin/hooks/useAutomatedFollows";
import { AdminEmptyState } from "@/features/admin/components/shared/AdminEmptyState";
import { AutomatedFollowCard } from "@/features/admin/components/social/AutomatedFollowCard";
import { FollowedAccountEvents } from "@/features/admin/components/social/FollowedAccountEvents";
import { FormGrid, Stack } from "@/shared/layout";
import { FilterBar } from "@/shared/layout/filter-bar";
import { Section } from "@/shared/layout/section";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import { Button } from "@/shared/ui/button";
import { DatePicker } from "@/shared/ui/date-picker";
import { Pagination } from "@/shared/ui/Pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { Skeleton } from "@/shared/ui/skeleton";

const ALL_SCHOOLS = "all";

/**
 * One day of the accounts school accounts followed on their own (found by the
 * crawl or a club directory), with the scorer's rating and newest posts of
 * each, then the events those accounts brought in that day. Days are the
 * admin's own.
 */
export function AutomatedFollowsPanel() {
  const { t } = useTranslation();
  const { schools, getSchoolName } = useSchoolDirectory();
  const view = useAutomatedFollows();
  const follows = view.follows.data;
  const events = view.events.data;

  return (
    <Stack gap={6}>
      <FilterBar
        trailing={
          <Stack direction="horizontal" align="center" gap={2}>
            <Button type="button" variant="outline" size="icon" aria-label={t("admin.automatedFollows.previousDay")} onClick={view.previousDay}>
              <ChevronLeft aria-hidden />
            </Button>
            <DatePicker value={view.day} onChange={view.setDay} placeholder={t("admin.automatedFollows.dayLabel")} />
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={t("admin.automatedFollows.nextDay")}
              disabled={view.isToday}
              onClick={view.nextDay}
            >
              <ChevronRight aria-hidden />
            </Button>
          </Stack>
        }
      >
        <Select value={view.school || ALL_SCHOOLS} onValueChange={(value) => view.setSchool(value === ALL_SCHOOLS ? "" : value)}>
          <SelectTrigger aria-label={t("admin.followCandidates.schoolLabel")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_SCHOOLS}>{t("admin.followCandidates.allSchools")}</SelectItem>
            {schools.map((school) => <SelectItem key={school.slug} value={school.slug}>{school.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </FilterBar>

      <Section title={t("admin.automatedFollows.followsTitle", { value: follows?.total ?? 0 })}>
        {view.follows.isError ? (
          <Button variant="outline" onClick={() => void view.follows.refetch()}>{t("common.tryAgain")}</Button>
        ) : view.follows.isPending ? (
          <Skeleton className="h-96 w-full" />
        ) : follows?.items.length ? (
          <>
            <FormGrid columns="gallery" className="items-stretch">
              {follows.items.map((follow) => (
                <AutomatedFollowCard key={follow.id} follow={follow} schoolName={getSchoolName(follow.school)} />
              ))}
            </FormGrid>
            {follows.total_pages > 1 ? (
              <Pagination currentPage={view.followPage} totalPages={follows.total_pages} onPageChange={view.setFollowPage} />
            ) : null}
          </>
        ) : (
          <AdminEmptyState
            icon={UserPlus}
            title={t("admin.automatedFollows.emptyTitle")}
            description={t("admin.automatedFollows.emptyDescription")}
          />
        )}
      </Section>

      <Section
        title={t("admin.automatedFollows.eventsTitle", { value: events?.total ?? 0 })}
        description={t("admin.automatedFollows.eventsDescription")}
      >
        {view.events.isError ? (
          <Button variant="outline" onClick={() => void view.events.refetch()}>{t("common.tryAgain")}</Button>
        ) : view.events.isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : events?.items.length ? (
          <>
            <FollowedAccountEvents events={events.items} getSchoolName={getSchoolName} />
            {events.total_pages > 1 ? (
              <Pagination currentPage={view.eventPage} totalPages={events.total_pages} onPageChange={view.setEventPage} />
            ) : null}
          </>
        ) : (
          <AdminEmptyState
            icon={CalendarDays}
            title={t("admin.automatedFollows.eventsEmptyTitle")}
            description={t("admin.automatedFollows.eventsEmptyDescription")}
          />
        )}
      </Section>
    </Stack>
  );
}
