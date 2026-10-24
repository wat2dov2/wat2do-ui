import { useTranslation } from "react-i18next";
import { useTicketCheckIn } from "@/features/tickets/hooks/useTickets";
import type { ApiTicketResponse } from "@/shared/generated";
import { Stack } from "@/shared/layout";
import { Button } from "@/shared/ui/button";
import { CardDescription } from "@/shared/ui/card";
import { LoadingButton } from "@/shared/ui/loading-button";
import { formatClock } from "@/features/tickets/lib/ticketFormat";

/** Admit a ticket from its own page: what an officer sees after scanning it with a phone camera. */
export function TicketCheckInControl({ ticket }: { ticket: ApiTicketResponse }) {
  const { t, i18n } = useTranslation();
  const checkIn = useTicketCheckIn(ticket.event_id);
  if (ticket.status === "refunded") {
    return <CardDescription>{t("tickets.door.results.refunded")}</CardDescription>;
  }
  const admitted = Boolean(ticket.checked_in_at);
  return (
    <Stack gap={2} align="center">
      <CardDescription>
        {admitted
          ? t("tickets.door.checkedInAt", { time: formatClock(ticket.checked_in_at, i18n.language) })
          : t("tickets.door.officerNote", { club: ticket.club_name ?? "" })}
      </CardDescription>
      {admitted ? (
        <Button
          type="button"
          variant="outline"
          disabled={checkIn.isPending}
          onClick={() => checkIn.mutate({ code: ticket.code, checkedIn: false })}
        >
          {t("tickets.door.undo")}
        </Button>
      ) : (
        <LoadingButton
          type="button"
          isLoading={checkIn.isPending}
          onClick={() => checkIn.mutate({ code: ticket.code, checkedIn: true })}
        >
          {t("tickets.door.checkIn")}
        </LoadingButton>
      )}
    </Stack>
  );
}
