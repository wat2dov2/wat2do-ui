import NextLink from "next/link";
import { useTranslation } from "react-i18next";
import type { ApiClubEventTicketSummary } from "@/shared/generated";
import { controlBox } from "@/shared/config/controlBox";
import { clubPanelEventTicketsPath } from "@/shared/constants/routes";
import { useUIStore } from "@/shared/store/ui.store";
import type { Event } from "@/shared/types";
import { Stack } from "@/shared/layout";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/shared/ui/item";
import { formatCents } from "@/shared/utils/currency";
import { formatOccurrence, getPrimaryOccurrence } from "@/shared/utils/date";

interface ClubEventListProps {
  events: Event[];
  /** Ticket sales by event id; events missing here don't sell tickets. */
  sales: Map<number, ApiClubEventTicketSummary>;
  timeZone: string;
}

/** A club's events with their ticket sales at a glance, and one click to edit or sell. */
export function ClubEventList({ events, sales, timeZone }: ClubEventListProps) {
  const { t, i18n } = useTranslation();
  const setEditingEvent = useUIStore((state) => state.setEditingEvent);

  return (
    <Stack gap={2}>
      {events.map((event) => {
        const occurrence = getPrimaryOccurrence(event);
        const summary = sales.get(event.id);
        return (
          <Item key={event.id} variant="outline">
            <ItemContent>
              <ItemTitle>{event.title}</ItemTitle>
              <ItemDescription>
                {occurrence ? formatOccurrence(occurrence, timeZone, i18n.language) : null}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <Stack direction="horizontal" gap={2} align="center" wrap>
                {event.cancelled ? (
                  <Badge variant="destructive">{t("clubPanel.eventsList.cancelled")}</Badge>
                ) : !controlBox.ticketing.enabled ? null : summary ? (
                  <Badge variant={summary.sales_paused ? "warning" : "success"}>
                    {summary.sales_paused
                      ? t("clubPanel.eventsList.salesPaused")
                      : t("clubPanel.eventsList.ticketsSold", {
                          count: summary.sold,
                          revenue: formatCents(summary.revenue_cents, summary.currency, i18n.language),
                        })}
                  </Badge>
                ) : (
                  <Badge variant="muted">{t("clubPanel.eventsList.notSelling")}</Badge>
                )}
                {controlBox.ticketing.enabled && summary?.refund_requests ? (
                  <Badge variant="warning">
                    {t("clubPanel.eventsList.refundRequests", { count: summary.refund_requests })}
                  </Badge>
                ) : null}
                {controlBox.ticketing.enabled ? (
                  <Button size="sm" variant={summary ? "primary" : "outline"} asChild>
                    <NextLink href={clubPanelEventTicketsPath(event.id)}>
                      {summary ? t("tickets.manage") : t("tickets.sellTickets")}
                    </NextLink>
                  </Button>
                ) : null}
                <Button size="sm" variant="ghost" onClick={() => setEditingEvent(event)}>
                  {t("common.edit")}
                </Button>
              </Stack>
            </ItemActions>
          </Item>
        );
      })}
    </Stack>
  );
}
