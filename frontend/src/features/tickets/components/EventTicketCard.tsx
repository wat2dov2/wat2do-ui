import { useState } from "react";
import NextLink from "next/link";
import { useTranslation } from "react-i18next";
import { EmailOtpForm } from "@/features/auth/components/EmailOtpForm";
import { useAuthState } from "@/features/auth/hooks/useAuthState";
import { useMyTickets, useTicketCheckout } from "@/features/tickets/hooks/useTickets";
import type { ApiEventTicketingResponse } from "@/shared/generated";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import { ROUTES } from "@/shared/constants/routes";
import type { Event } from "@/shared/types";
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
import { FormSelect } from "@/shared/ui/form-field";
import { LoadingButton } from "@/shared/ui/loading-button";
import { RadioOptionGroup } from "@/shared/ui/radio-option-group";
import { formatCents } from "@/shared/utils/currency";
import { formatOccurrence } from "@/shared/utils/date";

type Unavailable = "cancelled" | "paused" | "soldOut" | "closed" | "notOnSale";

/** Why nobody can buy right now, or null when tickets are on sale. */
function unavailableReason(event: Event, ticketing: ApiEventTicketingResponse): Unavailable | null {
  if (event.cancelled) return "cancelled";
  if (ticketing.sales_paused) return "paused";
  if (!ticketing.dates.some((date) => date.sales_open)) {
    return ticketing.dates.some((date) => date.remaining === 0) ? "soldOut" : "closed";
  }
  return ticketing.on_sale ? null : "notOnSale";
}

interface EventTicketCardProps {
  event: Event;
  ticketing: ApiEventTicketingResponse;
}

/** Buying tickets on an event's page: date, quantity, sign-in, then Stripe Checkout. */
export function EventTicketCard({ event, ticketing }: EventTicketCardProps) {
  const { t, i18n } = useTranslation();
  const { profileCompleted } = useAuthState();
  const { getSchoolTimezone } = useSchoolDirectory();
  const checkout = useTicketCheckout(event.id);
  const { data: myTickets } = useMyTickets();
  const openDates = ticketing.dates.filter((date) => date.sales_open);
  const [dateId, setDateId] = useState(openDates[0]?.event_date_id ?? "");
  const [quantity, setQuantity] = useState(1);

  const selected = openDates.find((date) => date.event_date_id === dateId) ?? openDates[0];
  const maxQuantity = Math.max(
    1,
    Math.min(ticketing.maximum_per_order, selected?.remaining ?? ticketing.maximum_per_order),
  );
  const count = Math.min(quantity, maxQuantity);
  const money = (cents: number) => formatCents(cents, ticketing.currency, i18n.language);
  const held = (myTickets ?? []).filter(
    (ticket) => ticket.event_id === event.id && ticket.status === "valid",
  ).length;
  const unavailable = unavailableReason(event, ticketing);
  // Stay busy after success too: the browser is already on its way to Stripe.
  const leaving = checkout.isPending || checkout.isSuccess;

  const buy = () => {
    if (!selected || leaving) return;
    checkout.mutate({ eventDateId: selected.event_date_id, quantity: count });
  };
  const remainingLabel = (remaining: number | null | undefined) =>
    remaining == null ? undefined : t("tickets.card.left", { count: remaining });

  return (
    <Card data-slot="event-ticket-card">
      <CardHeader>
        <CardTitle>{t("tickets.card.title")}</CardTitle>
        <CardDescription>
          {t("tickets.card.price", { price: money(ticketing.price_cents) })} ·{" "}
          {t("tickets.card.noFees")}
        </CardDescription>
        {held > 0 ? (
          <CardAction>
            <Badge variant="success">{t("tickets.card.youHave", { count: held })}</Badge>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent>
        {unavailable ? (
          <CardDescription>{t(`tickets.card.unavailable.${unavailable}`)}</CardDescription>
        ) : (
          <Stack gap={4}>
            {openDates.length > 1 ? (
              <RadioOptionGroup
                name={`ticket-date-${event.id}`}
                value={selected?.event_date_id ?? ""}
                onChange={setDateId}
                options={openDates.map((date) => ({
                  value: date.event_date_id,
                  label: formatOccurrence(date, getSchoolTimezone(event.school), i18n.language),
                  description: remainingLabel(date.remaining),
                }))}
              />
            ) : selected?.remaining != null ? (
              <CardDescription>{remainingLabel(selected.remaining)}</CardDescription>
            ) : null}
            <FormSelect
              name={`ticket-quantity-${event.id}`}
              label={t("tickets.card.quantity")}
              value={String(count)}
              onChange={(value) => setQuantity(Number(value))}
              options={Array.from({ length: maxQuantity }, (_, index) => ({
                value: String(index + 1),
                label: String(index + 1),
              }))}
            />
            {profileCompleted ? null : (
              <EmailOtpForm
                school={event.school}
                requestCodeLabel={t("tickets.card.continueToPayment")}
                actionLabel={t("tickets.card.continueToPayment")}
                focusOnMount={false}
                onAuthenticated={buy}
              />
            )}
            <CardDescription>
              {t("tickets.card.payNote", { club: event.club })}
            </CardDescription>
          </Stack>
        )}
      </CardContent>
      {held > 0 || (!unavailable && profileCompleted) ? (
        <CardFooter>
          <Stack gap={2} className="w-full">
            {!unavailable && profileCompleted ? (
              <LoadingButton type="button" isLoading={leaving} onClick={buy}>
                {t("tickets.card.buy", { total: money(ticketing.price_cents * count) })}
              </LoadingButton>
            ) : null}
            {held > 0 ? (
              <Button variant="outline" asChild>
                <NextLink href={ROUTES.TICKETS}>{t("tickets.card.viewTickets")}</NextLink>
              </Button>
            ) : null}
          </Stack>
        </CardFooter>
      ) : null}
    </Card>
  );
}
