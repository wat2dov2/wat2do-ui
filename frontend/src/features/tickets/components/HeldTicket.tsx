import { lazy, Suspense } from "react";
import NextLink from "next/link";
import { useTranslation } from "react-i18next";
import { TicketReturnControl } from "@/features/tickets/components/TicketReturnControl";
import { ticketUrl } from "@/features/tickets/lib/ticketFormat";
import { ticketPath } from "@/shared/constants/routes";
import type { ApiTicketResponse } from "@/shared/generated";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import { Stack } from "@/shared/layout";
import type { Event } from "@/shared/types";
import { Button } from "@/shared/ui/button";
import { CardDescription } from "@/shared/ui/card";
import { Skeleton } from "@/shared/ui/skeleton";
import { formatOccurrence } from "@/shared/utils/date";

// Only a held ticket shows its QR code, so the encoder loads with the first one.
const TicketQr = lazy(() =>
  import("@/features/tickets/components/TicketQr").then((module) => ({ default: module.TicketQr })),
);

/** A free ticket (an RSVP) the viewer holds: its QR code for the door, its date, and the way out. */
export function HeldTicket({ ticket, event }: { ticket: ApiTicketResponse; event: Event }) {
  const { t, i18n } = useTranslation();
  const { getSchoolTimezone } = useSchoolDirectory();
  return (
    <Stack gap={3} align="center">
      <Suspense fallback={<Skeleton className="size-56" />}>
        <TicketQr value={ticketUrl(ticket)} label={t("tickets.pass.qrLabel")} />
      </Suspense>
      <CardDescription>
        {formatOccurrence(ticket, getSchoolTimezone(event.school), i18n.language)}
      </CardDescription>
      <Stack direction="horizontal" gap={3} align="center" wrap>
        <Button variant="outline" size="sm" asChild>
          <NextLink href={ticketPath(ticket.code)}>{t("tickets.card.openTicket")}</NextLink>
        </Button>
        <TicketReturnControl ticket={ticket} />
      </Stack>
    </Stack>
  );
}
