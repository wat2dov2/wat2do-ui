import { useState } from "react";
import NextLink from "next/link";
import { useTranslation } from "react-i18next";
import { EmailOtpForm } from "@/features/auth/components/EmailOtpForm";
import { useAuthState } from "@/features/auth/hooks/useAuthState";
import { TicketDatePicker } from "@/features/tickets/components/TicketDatePicker";
import {
  useMyTickets,
  useTicketCheckout,
  useTicketsClub,
  useTicketUnavailableText,
} from "@/features/tickets/hooks/useTickets";
import { ticketUnavailableReason } from "@/features/tickets/lib/ticketFormat";
import { ROUTES } from "@/shared/constants/routes";
import type { ApiEventTicketingResponse } from "@/shared/generated";
import { Stack } from "@/shared/layout";
import type { Event } from "@/shared/types";
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
import { formatCents } from "@/shared/utils/currency";

interface EventTicketCardProps {
  event: Event;
  ticketing: ApiEventTicketingResponse;
}

/**
 * Buying tickets to an event, right on its page: date, how many, sign-in, then
 * Stripe Checkout on the club's account. Free tickets are an RSVP instead (the
 * event page's Going card, with `useFreeTicketRsvp`).
 */
export function EventTicketCard({ event, ticketing }: EventTicketCardProps) {
  const { t, i18n } = useTranslation();
  const { profileCompleted } = useAuthState();
  const { data: myTickets } = useMyTickets();
  const held = (myTickets ?? []).filter(
    (ticket) => ticket.event_id === event.id && ticket.status === "valid",
  );
  const checkout = useTicketCheckout(event.id);
  const openDates = ticketing.dates.filter((date) => date.open);
  const [dateId, setDateId] = useState("");
  const selected = openDates.find((date) => date.event_date_id === dateId) ?? openDates[0];
  const [quantity, setQuantity] = useState(1);
  const currency = ticketing.currency ?? "cad";
  // A ticket costs what the release it comes from costs, which can differ by date.
  const priceCents = (selected ?? ticketing.dates[0])?.price_cents ?? 0;
  const maxQuantity = Math.max(
    1,
    Math.min(ticketing.maximum_per_order, selected?.remaining ?? ticketing.maximum_per_order),
  );
  const count = Math.min(quantity, maxQuantity);
  const money = (cents: number) => formatCents(cents, currency, i18n.language);
  const ownEvent = useTicketsClub(event.club_id) !== null;
  const unavailable = ticketUnavailableReason(event, ticketing, openDates, ownEvent);
  const unavailableText = useTicketUnavailableText(event, ticketing, unavailable);
  const total = money(priceCents * count);
  // The club's own team sees the button, turned off, beside why.
  const showBuy = profileCompleted && (!unavailable || unavailable === "ownEvent");
  // Stay busy after success too: the browser is already on its way to Stripe.
  const leaving = checkout.isPending || checkout.isSuccess;

  const buy = () => {
    if (!selected || leaving) return;
    checkout.mutate({ eventDateId: selected.event_date_id, quantity: count });
  };

  return (
    <Card data-slot="event-ticket-card">
      <CardHeader>
        <CardTitle>{t("tickets.card.paidTitle")}</CardTitle>
        <CardDescription>
          {t("tickets.card.price", { price: money(priceCents) })} ·{" "}
          {t("tickets.card.noFees")}
        </CardDescription>
        {held.length ? (
          <CardAction>
            <Badge variant="success">{t("tickets.card.youHave", { count: held.length })}</Badge>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent>
        {unavailable ? (
          <CardDescription>{unavailableText}</CardDescription>
        ) : (
          <Stack gap={4}>
            <TicketDatePicker
              event={event}
              dates={openDates}
              selectedDateId={selected?.event_date_id ?? ""}
              onSelect={setDateId}
            />
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
              {t("tickets.card.payNote", { club: event.club ?? t("tickets.refund.theClub") })}
            </CardDescription>
          </Stack>
        )}
      </CardContent>
      {held.length || showBuy ? (
        <CardFooter>
          <Stack gap={2} grow>
            {showBuy ? (
              <LoadingButton
                type="button"
                isLoading={leaving}
                disabled={unavailable !== null}
                onClick={buy}
              >
                {selected?.remaining != null
                  ? t("tickets.card.buyLeft", { total, count: selected.remaining })
                  : t("tickets.card.buy", { total })}
              </LoadingButton>
            ) : null}
            {held.length ? (
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
