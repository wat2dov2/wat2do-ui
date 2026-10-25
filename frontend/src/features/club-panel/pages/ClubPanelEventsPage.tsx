import { useTranslation } from "react-i18next";
import { useRouter } from "next/navigation";
import { Calendar, Plus } from "lucide-react";
import { ClubEventsGrid } from "@/features/events";
import { useActiveClub } from "@/features/club-panel/hooks/useActiveClub";
import { NoActiveClub } from "@/features/club-panel/pages/NoActiveClub";
import { ROUTES } from "@/shared/constants/routes";
import { PageHeader, Stack } from "@/shared/layout";
import { Button } from "@/shared/ui/button";

/** Every event the active club has run; opening one lets its members edit or delete it. */
export function ClubPanelEventsPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { clubId, club } = useActiveClub();
  if (!clubId) return <NoActiveClub />;

  return (
    <Stack gap={5}>
      <PageHeader
        back={{ label: t("clubPanel.backToPanel"), onClick: () => router.push(ROUTES.CLUB_PANEL) }}
        icon={Calendar}
        title={t("navigation.events")}
        description={t("clubPanel.eventsDesc")}
        actions={
          <Button onClick={() => router.push(ROUTES.EVENT_SUBMIT)}>
            <Plus />
            {t("events.createEvent")}
          </Button>
        }
      />
      {club ? <ClubEventsGrid clubId={clubId} school={club.school} /> : null}
    </Stack>
  );
}
