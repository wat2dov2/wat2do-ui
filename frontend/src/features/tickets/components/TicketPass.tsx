import type { ReactNode } from "react";
import NextLink from "next/link";
import { useTranslation } from "react-i18next";
import type { ApiTicketResponse } from "@/shared/generated";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import { eventPagePath } from "@/features/events/lib/eventUrls";
import { Stack } from "@/shared/layout";
import { Button } from "@/shared/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import { Item, ItemContent, ItemDescription, ItemTitle } from "@/shared/ui/item";
import { formatOccurrence } from "@/shared/utils/date";
import { TicketQr } from "@/features/tickets/components/TicketQr";
import { TicketStatusBadge } from "@/features/tickets/components/TicketStatusBadge";
import { formatTicketCode, ticketUrl } from "@/features/tickets/lib/ticketFormat";

interface TicketPassProps {
  ticket: ApiTicketResponse;
  /** Shown under the QR code, e.g. a club officer's check-in controls. */
  children?: ReactNode;
}

/** One admission as its holder shows it at the door. */
export function TicketPass({ ticket, children }: TicketPassProps) {
  const { t, i18n } = useTranslation();
  const { getSchoolTimezone } = useSchoolDirectory();
  const when = formatOccurrence(ticket, getSchoolTimezone(ticket.school), i18n.language);
  const details: Array<[string, string]> = [
    [t("tickets.pass.when"), when],
    [t("tickets.pass.where"), ticket.location ?? t("tickets.pass.locationTba")],
    [t("tickets.pass.holder"), ticket.holder_name],
    [t("tickets.pass.code"), formatTicketCode(ticket.code)],
  ];

  return (
    <Card data-slot="ticket-pass">
      <CardHeader>
        <CardTitle>{ticket.event_title}</CardTitle>
        {ticket.club_name ? <CardDescription>{ticket.club_name}</CardDescription> : null}
        <CardAction>
          <TicketStatusBadge status={ticket.status} checkedInAt={ticket.checked_in_at} />
        </CardAction>
      </CardHeader>
      <CardContent>
        <Stack gap={5} align="center">
          {ticket.status === "valid" ? (
            <Stack gap={3} align="center">
              <TicketQr value={ticketUrl(ticket)} label={t("tickets.pass.qrLabel")} />
              <CardDescription>{t("tickets.pass.showAtDoor")}</CardDescription>
            </Stack>
          ) : (
            <CardDescription>{t("tickets.pass.refundedNote")}</CardDescription>
          )}
          {children}
          <Stack gap={1} className="w-full">
            {details.map(([label, value]) => (
              <Item key={label} size="sm" variant="muted">
                <ItemContent>
                  <ItemDescription>{label}</ItemDescription>
                  <ItemTitle>{value}</ItemTitle>
                </ItemContent>
              </Item>
            ))}
          </Stack>
        </Stack>
      </CardContent>
      <CardFooter>
        <Button variant="outline" asChild>
          <NextLink href={eventPagePath(ticket.event_id)}>{t("tickets.pass.viewEvent")}</NextLink>
        </Button>
      </CardFooter>
    </Card>
  );
}
