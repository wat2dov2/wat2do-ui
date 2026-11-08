import { useTranslation } from "react-i18next";
import { useEventIdParam } from "@/features/club-panel/hooks/useClubPanelEvent";
import { DoorScanner, useTicketDesk } from "@/features/tickets";
import { clubPanelEventTicketsPath } from "@/shared/constants/routes";
import { PageHeader, Stack } from "@/shared/layout";
import { QrCode } from "lucide-react";

/** A phone at the door, checking one event's tickets in. */
export function ClubPanelDoorScannerPage() {
  const { t } = useTranslation();
  const eventId = useEventIdParam();
  const { data: desk } = useTicketDesk(eventId, eventId > 0);

  return (
    <Stack gap={6}>
      <PageHeader
        back={{ href: clubPanelEventTicketsPath(eventId), label: t("tickets.desk.title") }}
        icon={QrCode}
        title={t("tickets.scanner.title")}
        description={
          desk
            ? t("tickets.scanner.admitted", { checkedIn: desk.checked_in, issued: desk.issued })
            : t("tickets.scanner.description")
        }
      />
      <DoorScanner eventId={eventId} />
    </Stack>
  );
}
