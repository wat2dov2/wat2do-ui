"use client";

import NextLink from "next/link";
import { useTranslation } from "react-i18next";
import { TicketStatusBadge } from "@/features/tickets/components/TicketStatusBadge";
import { useCurrentTime } from "@/features/events/hooks/useGoingEvents";
import { useMyTickets } from "@/features/tickets/hooks/useTickets";
import type { ApiTicketResponse } from "@/shared/generated";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import { ROUTES, ticketPath } from "@/shared/constants/routes";
import { EmptyState } from "@/shared/feedback";
import { Container, PageHeader, Section, Stack } from "@/shared/layout";
import { Button } from "@/shared/ui/button";
import { Ticket } from "lucide-react";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/shared/ui/item";
import { Skeleton } from "@/shared/ui/skeleton";
import { formatOccurrence } from "@/shared/utils/date";

/** A date still counts as upcoming for a few hours after it starts, while the event runs. */
const STILL_ON_MS = 6 * 60 * 60 * 1000;

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

/** Every ticket the student bought, upcoming first. */
export function MyTicketsPage() {
  const { t } = useTranslation();
  const { data: tickets, isPending } = useMyTickets();
  const now = useCurrentTime();
  const upcoming = (tickets ?? []).filter(
    (ticket) => now === null || new Date(ticket.dtstart_utc).getTime() + STILL_ON_MS >= now,
  );
  const past = (tickets ?? []).filter((ticket) => !upcoming.includes(ticket)).reverse();

  return (
    <Container size="md">
      <Stack gap={6}>
        <PageHeader icon={Ticket} title={t("tickets.title")} description={t("tickets.description")} />
        {isPending ? (
          <Stack gap={2}>
            <Skeleton className="h-20 w-full rounded-xl" />
            <Skeleton className="h-20 w-full rounded-xl" />
          </Stack>
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
