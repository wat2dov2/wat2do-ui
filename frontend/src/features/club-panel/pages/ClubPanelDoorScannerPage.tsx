import { useParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import { DoorScanner, useTicketSales } from "@/features/tickets";
import { clubPanelEventTicketsPath } from "@/shared/constants/routes";
import { PageHeader, Stack } from "@/shared/layout";
import { QrCode } from "lucide-react";

/** A phone at the door, scanning one event's tickets. */
export function ClubPanelDoorScannerPage() {
  const { t } = useTranslation();
  const params = useParams<{ eventId?: string | string[] }>();
  const eventId = Number(Array.isArray(params.eventId) ? params.eventId[0] : params.eventId) || 0;
  const { data: sales } = useTicketSales(eventId, eventId > 0);

  return (
    <Stack gap={6}>
      <PageHeader
        back={{ href: clubPanelEventTicketsPath(eventId), label: t("tickets.desk.title") }}
        icon={QrCode}
        title={t("tickets.scanner.title")}
        description={
          sales
            ? t("tickets.scanner.admitted", { checkedIn: sales.checked_in, sold: sales.sold })
            : t("tickets.scanner.description")
        }
      />
      <DoorScanner eventId={eventId} />
    </Stack>
  );
}
