import { lazy, Suspense, useState } from "react";
import NextLink from "next/link";
import { useTranslation } from "react-i18next";
import { EmailOtpForm } from "@/features/auth/components/EmailOtpForm";
import { useAuthState } from "@/features/auth/hooks/useAuthState";
import { TicketReturnControl } from "@/features/tickets/components/TicketReturnControl";
import {
  useMyTickets,
  useTakeFreeTicket,
  useTicketCheckout,
} from "@/features/tickets/hooks/useTickets";
import { ticketUrl } from "@/features/tickets/lib/ticketFormat";
import { ROUTES, ticketPath } from "@/shared/constants/routes";
import type { ApiEventTicketingResponse, ApiTicketResponse } from "@/shared/generated";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
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
import { RadioOptionGroup } from "@/shared/ui/radio-option-group";
import { Skeleton } from "@/shared/ui/skeleton";
import { formatCents } from "@/shared/utils/currency";
import { formatOccurrence } from "@/shared/utils/date";

// Only a held ticket shows its QR code, so the encoder loads with the first one.
const TicketQr = lazy(() =>
  import("@/features/tickets/components/TicketQr").then((module) => ({ default: module.TicketQr })),
);

type Unavailable = "cancelled" | "paused" | "soldOut" | "closed" | "notYet";
type TicketDate = ApiEventTicketingResponse["dates"][number];

/** Why nobody can get a ticket right now, or null when they can. */
function unavailableReason(
  event: Event,
  ticketing: ApiEventTicketingResponse,
  openDates: TicketDate[],
): Unavailable | null {
  if (event.cancelled) return "cancelled";
  if (ticketing.paused) return "paused";
  if (!openDates.length) {
    return ticketing.dates.some((date) => date.remaining === 0) ? "soldOut" : "closed";
  }
  return ticketing.available ? null : "notYet";
}

interface EventTicketCardProps {
  event: Event;
  ticketing: ApiEventTicketingResponse;
}

/** Getting into an event with tickets, right on its page. */
export function EventTicketCard({ event, ticketing }: EventTicketCardProps) {
  const { data: myTickets } = useMyTickets();
  const held = (myTickets ?? []).filter(
    (ticket) => ticket.event_id === event.id && ticket.status === "valid",
  );
  return ticketing.price_cents === 0 ? (
    <FreeTicketCard event={event} ticketing={ticketing} held={held} />
  ) : (
    <PaidTicketCard event={event} ticketing={ticketing} held={held} />
  );
}

interface TicketCardProps extends EventTicketCardProps {
  /** The viewer's valid tickets to this event. */
  held: ApiTicketResponse[];
}

/** The date a ticket is for, picked only when the event has several still open. */
function useDateChoice(event: Event, dates: TicketDate[]) {
  const { t, i18n } = useTranslation();
  const { getSchoolTimezone } = useSchoolDirectory();
  const [dateId, setDateId] = useState(dates[0]?.event_date_id ?? "");
  const selected = dates.find((date) => date.event_date_id === dateId) ?? dates[0];
  const remaining = (date: TicketDate | undefined) =>
    date?.remaining == null ? undefined : t("tickets.card.left", { count: date.remaining });
  const picker =
    dates.length > 1 ? (
      <RadioOptionGroup
        name={`ticket-date-${event.id}`}
        value={selected?.event_date_id ?? ""}
        onChange={setDateId}
        options={dates.map((date) => ({
          value: date.event_date_id,
          label: formatOccurrence(date, getSchoolTimezone(event.school), i18n.language),
          description: remaining(date),
        }))}
      />
    ) : remaining(selected) ? (
      <CardDescription>{remaining(selected)}</CardDescription>
    ) : null;
  return { selected, picker };
}

/** One tap for a free ticket; then its QR code shows here, ready for the door. */
function FreeTicketCard({ event, ticketing, held }: TicketCardProps) {
  const { t } = useTranslation();
  const { profileCompleted } = useAuthState();
  const take = useTakeFreeTicket(event.id);
  const heldDates = new Set(held.map((ticket) => ticket.event_date_id));
  const openDates = ticketing.dates.filter(
    (date) => date.open && !heldDates.has(date.event_date_id),
  );
  const { selected, picker } = useDateChoice(event, openDates);
  const [addingDate, setAddingDate] = useState(false);
  const unavailable = unavailableReason(event, ticketing, openDates);
  const getTicket = () => {
    if (selected && !take.isPending) take.mutate(selected.event_date_id);
  };

  const getForm = unavailable ? null : (
    <Stack gap={4}>
      {picker}
      {profileCompleted ? (
        <LoadingButton type="button" isLoading={take.isPending} onClick={getTicket}>
          {t("tickets.card.getFree")}
        </LoadingButton>
      ) : (
        <EmailOtpForm
          school={event.school}
          requestCodeLabel={t("tickets.card.getFree")}
          actionLabel={t("tickets.card.getFree")}
          focusOnMount={false}
          onAuthenticated={getTicket}
        />
      )}
      <CardDescription>
        {t("tickets.card.checkInNote", { club: event.club ?? t("tickets.refund.theClub") })}
      </CardDescription>
    </Stack>
  );

  if (held.length) {
    return (
      <Card data-slot="event-ticket-card">
        <CardHeader>
          <CardTitle>{t("tickets.card.youreIn")}</CardTitle>
          <CardDescription>{t("tickets.card.showAtDoor")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Stack gap={6}>
            {held.map((ticket) => (
              <HeldTicket key={ticket.code} ticket={ticket} event={event} />
            ))}
            {addingDate ? getForm : null}
          </Stack>
        </CardContent>
        {openDates.length && !addingDate && !unavailable ? (
          <CardFooter>
            <Button type="button" variant="outline" onClick={() => setAddingDate(true)}>
              {t("tickets.card.anotherDate")}
            </Button>
          </CardFooter>
        ) : null}
      </Card>
    );
  }

  return (
    <Card data-slot="event-ticket-card">
      <CardHeader>
        <CardTitle>{t("tickets.card.freeTitle")}</CardTitle>
        <CardDescription>{t("tickets.card.freeDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        {unavailable ? (
          <CardDescription>{t(`tickets.card.unavailable.${unavailable}`)}</CardDescription>
        ) : (
          getForm
        )}
      </CardContent>
    </Card>
  );
}

/** A ticket the viewer holds: its QR code, its date, and the way out. */
function HeldTicket({ ticket, event }: { ticket: ApiTicketResponse; event: Event }) {
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

/** Buying tickets: date, how many, sign-in, then Stripe Checkout on the club's account. */
function PaidTicketCard({ event, ticketing, held }: TicketCardProps) {
  const { t, i18n } = useTranslation();
  const { profileCompleted } = useAuthState();
  const checkout = useTicketCheckout(event.id);
  const openDates = ticketing.dates.filter((date) => date.open);
  const { selected, picker } = useDateChoice(event, openDates);
  const [quantity, setQuantity] = useState(1);
  const currency = ticketing.currency ?? "cad";
  const maxQuantity = Math.max(
    1,
    Math.min(ticketing.maximum_per_order, selected?.remaining ?? ticketing.maximum_per_order),
  );
  const count = Math.min(quantity, maxQuantity);
  const money = (cents: number) => formatCents(cents, currency, i18n.language);
  const unavailable = unavailableReason(event, ticketing, openDates);
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
          {t("tickets.card.price", { price: money(ticketing.price_cents) })} ·{" "}
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
          <CardDescription>{t(`tickets.card.unavailable.${unavailable}`)}</CardDescription>
        ) : (
          <Stack gap={4}>
            {picker}
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
      {held.length || (!unavailable && profileCompleted) ? (
        <CardFooter>
          <Stack gap={2} grow>
            {!unavailable && profileCompleted ? (
              <LoadingButton type="button" isLoading={leaving} onClick={buy}>
                {t("tickets.card.buy", { total: money(ticketing.price_cents * count) })}
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
