import { useTranslation } from "react-i18next";
import { PageShellHeader } from "@/shared/layout/page-shell-header";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { ClubEventsGrid } from "@/features/events";
import { useActiveClub } from "@/features/clubs";
import { NoActiveClub } from "@/features/club-panel/pages/NoActiveClub";
import { ROUTES } from "@/shared/constants/routes";
import { Stack } from "@/shared/layout";
import { Button } from "@/shared/ui/button";

/** Every event the active club has run; opening one lets its members edit or delete it. */
export function ClubPanelEventsPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { clubId, club } = useActiveClub();
  if (!clubId) return <NoActiveClub />;

  return (
    <Stack gap={5}>
      <PageShellHeader
        route={ROUTES.CLUB_PANEL_EVENTS}
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
