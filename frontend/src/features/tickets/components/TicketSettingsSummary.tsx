import NextLink from "next/link";
import { useTranslation } from "react-i18next";
import type { ApiEventTicketDeskResponse, ApiEventTicketingResponse } from "@/shared/generated";
import { Stack } from "@/shared/layout";
import { Badge } from "@/shared/ui/badge";
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
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/shared/ui/item";
import { formatCents } from "@/shared/utils/currency";

interface TicketSettingsSummaryProps {
  /** Null until the event has tickets. */
  ticketing: ApiEventTicketingResponse | null;
  /** Each tier's tickets so far, once there are tickets. */
  desk: ApiEventTicketDeskResponse | undefined;
  /** The form that sets tickets up, or changes them. */
  settingsHref: string;
}

/** An event's ticket settings at a glance, with the way into the form that changes them. */
export function TicketSettingsSummary({ ticketing, desk, settingsHref }: TicketSettingsSummaryProps) {
  const { t, i18n } = useTranslation();

  if (!ticketing) {
    return (
      <Card data-slot="ticket-settings-summary">
        <CardHeader>
          <CardTitle>{t("tickets.desk.setupTitle")}</CardTitle>
          <CardDescription>{t("tickets.desk.setupDescription")}</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button asChild>
            <NextLink href={settingsHref}>{t("tickets.setUp")}</NextLink>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  const issued = new Map(desk?.tiers.map((tier) => [tier.tier_id, tier.issued]));
  const price = (cents: number) =>
    cents === 0
      ? t("common.free")
      : formatCents(cents, ticketing.currency ?? "cad", i18n.language);
  const taken = (count: number, capacity: number | null) =>
    capacity == null
      ? t("tickets.desk.taken", { count })
      : t("tickets.desk.takenOfLimit", { count, limit: capacity });

  return (
    <Card data-slot="ticket-settings-summary">
      <CardHeader>
        <CardTitle>{t("tickets.desk.settingsTitle")}</CardTitle>
        <CardDescription>
          {ticketing.capacity == null
            ? t("tickets.desk.noEventLimit")
            : t("tickets.desk.eventLimit", { count: ticketing.capacity })}
        </CardDescription>
        <CardAction>
          <Button variant="outline" asChild>
            <NextLink href={settingsHref}>{t("tickets.desk.editTickets")}</NextLink>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <Stack gap={2}>
          {ticketing.paused ? (
            <Stack align="start">
              <Badge variant="warning">{t("tickets.desk.paused")}</Badge>
            </Stack>
          ) : null}
          {ticketing.tiers.map((tier) => (
            <Item key={tier.id} variant="outline" size="sm">
              <ItemContent>
                <ItemTitle>{tier.name}</ItemTitle>
                <ItemDescription>{taken(issued.get(tier.id) ?? 0, tier.capacity)}</ItemDescription>
              </ItemContent>
              <ItemActions>{price(tier.price_cents)}</ItemActions>
            </Item>
          ))}
        </Stack>
      </CardContent>
    </Card>
  );
}
