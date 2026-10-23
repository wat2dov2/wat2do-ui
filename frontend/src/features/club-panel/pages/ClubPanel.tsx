import NextLink from "next/link";
import { useTranslation } from "react-i18next";
import { useActiveClub } from "@/features/auth";
import { ClubEventList } from "@/features/club-panel/components/ClubEventList";
import { ClubPayoutsCard } from "@/features/club-panel/components/ClubPayoutsCard";
import { useClubEvents } from "@/features/club-panel/hooks/useClubEvents";
import { useClubRecord } from "@/features/club-panel/hooks/useClubRecord";
import { useClubPayouts } from "@/features/club-panel/hooks/useClubTicketing";
import { controlBox } from "@/shared/config/controlBox";
import type { ClubPanelRouteKey } from "@/shared/constants/routes";
import { ROUTES } from "@/shared/constants/routes";
import { EmptyState } from "@/shared/feedback";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import { FormGrid, PageHeader, Section, Stack } from "@/shared/layout";
import { AdminCard } from "@/shared/ui/AdminCard";
import { Button } from "@/shared/ui/button";
import {
  Building2,
  Calendar,
  Coins,
  Link,
  Megaphone,
  Plus,
  ShieldAlert,
  Users,
} from "lucide-react";
import { Skeleton } from "@/shared/ui/skeleton";

// The dashboard previews a few upcoming events; the events page lists them all.
const DASHBOARD_EVENT_COUNT = 4;

interface ClubPanelProps {
  onNavigate: (page: ClubPanelRouteKey) => void;
}

/** A club's home: payouts, what's coming up and how tickets are selling, and every tool. */
export function ClubPanel({ onNavigate }: ClubPanelProps) {
  const { t } = useTranslation();
  const activeClub = useActiveClub();
  const { data: club } = useClubRecord(activeClub?.id);
  const { data: payouts } = useClubPayouts(controlBox.ticketing.enabled ? activeClub?.id : null);
  const { getSchoolTimezone } = useSchoolDirectory();
  const { upcoming, sales, isLoading } = useClubEvents(activeClub?.id, club?.school);

  if (!activeClub) {
    return (
      <EmptyState
        icon={<ShieldAlert />}
        title={t("clubPanel.noActiveClubSelected")}
        description={t("clubPanel.noActiveClubSelectedDesc")}
      />
    );
  }

  const tools: Array<{ page: ClubPanelRouteKey; icon: typeof Users; title: string; description: string }> = [
    { page: "club-panel-events", icon: Calendar, title: t("clubPanel.events"), description: t("clubPanel.eventsDesc") },
    ...(controlBox.ticketing.enabled
      ? [{ page: "club-panel-payouts" as const, icon: Coins, title: t("clubPanel.payouts.title"), description: t("clubPanel.payoutsDesc") }]
      : []),
    { page: "club-panel-members", icon: Users, title: t("clubPanel.members"), description: t("clubPanel.membersDesc") },
    { page: "club-panel-posters", icon: Megaphone, title: t("clubPanel.posters"), description: t("clubPanel.postersDesc") },
    { page: "club-panel-integrations", icon: Link, title: t("clubPanel.integrations"), description: t("clubPanel.integrationsDesc") },
  ];

  return (
    <Stack gap={6}>
      <PageHeader
        icon={Building2}
        title={activeClub.club_name}
        actions={
          <Button asChild>
            <NextLink href={ROUTES.EVENT_SUBMIT}>
              <Plus className="size-4" />
              {t("clubPanel.createEvent")}
            </NextLink>
          </Button>
        }
      />

      {payouts?.ticketing_enabled ? <ClubPayoutsCard clubId={activeClub.id} status={payouts} /> : null}

      <Section
        title={t("clubPanel.upcomingEvents")}
        action={
          <Button variant="link" size="inline" onClick={() => onNavigate("club-panel-events")}>
            {t("clubPanel.viewAllEvents")}
          </Button>
        }
      >
        {isLoading ? (
          <Skeleton className="h-32 w-full rounded-xl" />
        ) : upcoming.length ? (
          <ClubEventList
            events={upcoming.slice(0, DASHBOARD_EVENT_COUNT)}
            sales={sales}
            timeZone={getSchoolTimezone(club?.school)}
          />
        ) : (
          <EmptyState
            icon={<Calendar />}
            title={t("clubPanel.noUpcomingEvents")}
            description={t("clubPanel.noUpcomingEventsDesc")}
          />
        )}
      </Section>

      <FormGrid columns={3}>
        {tools.map(({ page, icon, title, description }) => (
          <AdminCard
            key={page}
            icon={icon}
            title={title}
            description={description}
            onClick={() => onNavigate(page)}
          />
        ))}
      </FormGrid>
    </Stack>
  );
}
