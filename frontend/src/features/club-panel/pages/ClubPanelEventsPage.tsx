import NextLink from "next/link";
import { useTranslation } from "react-i18next";
import { useActiveClub } from "@/features/auth";
import { ClubEventList } from "@/features/club-panel/components/ClubEventList";
import { useClubEvents } from "@/features/club-panel/hooks/useClubEvents";
import { useClubRecord } from "@/features/club-panel/hooks/useClubRecord";
import { ROUTES } from "@/shared/constants/routes";
import { EmptyState } from "@/shared/feedback";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import { PageHeader, Stack } from "@/shared/layout";
import { Button } from "@/shared/ui/button";
import { Calendar, Plus } from "lucide-react";
import { Skeleton } from "@/shared/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";

/** Every event the club has run or will run, each one a click from its ticket desk. */
export function ClubPanelEventsPage() {
  const { t } = useTranslation();
  const activeClub = useActiveClub();
  const { data: club } = useClubRecord(activeClub?.id);
  const { getSchoolTimezone } = useSchoolDirectory();
  const { upcoming, past, sales, isLoading } = useClubEvents(activeClub?.id, club?.school);
  const timeZone = getSchoolTimezone(club?.school);

  return (
    <Stack gap={6}>
      <PageHeader
        back={{ href: ROUTES.CLUB_PANEL, label: t("clubPanel.backToPanel") }}
        icon={Calendar}
        title={t("clubPanel.events")}
        description={t("clubPanel.eventsDesc")}
        actions={
          <Button asChild>
            <NextLink href={ROUTES.EVENT_SUBMIT}>
              <Plus className="size-4" />
              {t("clubPanel.createEvent")}
            </NextLink>
          </Button>
        }
      />
      <Tabs defaultValue="upcoming">
        <TabsList>
          <TabsTrigger value="upcoming">{t("clubPanel.upcomingEvents")}</TabsTrigger>
          <TabsTrigger value="past">{t("clubPanel.pastEvents")}</TabsTrigger>
        </TabsList>
        {(["upcoming", "past"] as const).map((tab) => {
          const events = tab === "upcoming" ? upcoming : past;
          return (
            <TabsContent key={tab} value={tab}>
              {isLoading ? (
                <Skeleton className="h-48 w-full rounded-xl" />
              ) : events.length ? (
                <ClubEventList events={events} sales={sales} timeZone={timeZone} />
              ) : (
                <EmptyState
                  icon={<Calendar />}
                  title={tab === "upcoming" ? t("clubPanel.noUpcomingEvents") : t("clubPanel.noPastEvents")}
                  description={tab === "upcoming" ? t("clubPanel.noUpcomingEventsDesc") : undefined}
                />
              )}
            </TabsContent>
          );
        })}
      </Tabs>
    </Stack>
  );
}
