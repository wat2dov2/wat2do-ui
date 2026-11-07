"use client";

import { PageShellHeader } from "@/shared/layout/page-shell-header";
import NextLink from "next/link";
import { useTranslation } from "react-i18next";
import { useCurrentTime } from "@/features/events/hooks/useGoingEvents";
import { TicketStatusBadge } from "@/features/tickets/components/TicketStatusBadge";
import { useMyTickets } from "@/features/tickets/hooks/useTickets";
import { ROUTES, ticketPath } from "@/shared/constants/routes";
import { EmptyState } from "@/shared/feedback";
import type { ApiTicketResponse } from "@/shared/generated";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import { Container, Section, Stack } from "@/shared/layout";
import { Button } from "@/shared/ui/button";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/shared/ui/item";
import { LoadingPage } from "@/shared/ui/loading-page";
import { formatOccurrence } from "@/shared/utils/date";
import { Ticket } from "lucide-react";

function TicketRow({ ticket }: { ticket: ApiTicketResponse }) {
  const { i18n } = useTranslation();
  const { getSchoolTimezone } = useSchoolDirectory();
  return (
    <Item variant="outline" asChild>
      <NextLink href={ticketPath(ticket.code)}>
        <ItemContent>
          <ItemTitle>{ticket.event_title}</ItemTitle>
          <ItemDescription>
            {formatOccurrence(ticket, getSchoolTimezone(ticket.school), i18n.language)}
            {ticket.location ? ` · ${ticket.location}` : ""}
          </ItemDescription>
        </ItemContent>
        <ItemActions>
          <TicketStatusBadge status={ticket.status} checkedInAt={ticket.checked_in_at} />
        </ItemActions>
      </NextLink>
    </Item>
  );
}

/** Every ticket the student holds, upcoming first. */
export function MyTicketsPage() {
  const { t } = useTranslation();
  const { data: tickets, isPending } = useMyTickets();
  const now = useCurrentTime();
  // A ticket stays upcoming until its date ends, while the event runs.
  const isUpcoming = (ticket: ApiTicketResponse) =>
    now === null || new Date(ticket.dtend_utc ?? ticket.dtstart_utc).getTime() >= now;
  const upcoming = (tickets ?? []).filter(isUpcoming);
  const past = (tickets ?? []).filter((ticket) => !isUpcoming(ticket)).reverse();

  return (
    <Container size="md">
      <Stack gap={6}>
        <PageShellHeader route={ROUTES.TICKETS} />
        {isPending ? (
          <LoadingPage variant="rows" className="py-0" />
        ) : !tickets?.length ? (
          <EmptyState
            icon={<Ticket />}
            title={t("tickets.empty.title")}
            description={t("tickets.empty.description")}
            action={
              <Button asChild>
                <NextLink href={ROUTES.EVENTS}>{t("tickets.empty.action")}</NextLink>
              </Button>
            }
          />
        ) : (
          <Stack gap={8}>
            {upcoming.length ? (
              <Section title={t("tickets.upcoming")}>
                <Stack gap={2}>
                  {upcoming.map((ticket) => (
                    <TicketRow key={ticket.code} ticket={ticket} />
                  ))}
                </Stack>
              </Section>
            ) : null}
            {past.length ? (
              <Section title={t("tickets.past")}>
                <Stack gap={2}>
                  {past.map((ticket) => (
                    <TicketRow key={ticket.code} ticket={ticket} />
                  ))}
                </Stack>
              </Section>
            ) : null}
          </Stack>
        )}
      </Stack>
    </Container>
  );
}
