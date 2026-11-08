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
import { ticketPath } from "@/shared/constants/routes";
import type { ApiEventTicketingResponse, ApiTicketResponse, ApiTicketTier } from "@/shared/generated";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import { Stack } from "@/shared/layout";
import type { Event } from "@/shared/types";
import { Button } from "@/shared/ui/button";
import {
  Card,
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
function unavailableReason(event: Event, ticketing: ApiEventTicketingResponse): Unavailable | null {
  if (event.cancelled) return "cancelled";
  if (ticketing.paused) return "paused";
  if (!ticketing.dates.some((date) => date.open)) return "closed";
  if (ticketing.tiers.every((tier) => tier.remaining === 0)) return "soldOut";
  return ticketing.available ? null : "notYet";
}

interface EventTicketCardProps {
  event: Event;
  ticketing: ApiEventTicketingResponse;
}

/** Getting into an event with tickets, right on its page. */
export function EventTicketCard({ event, ticketing }: EventTicketCardProps) {
  const { t } = useTranslation();
  const { data: myTickets } = useMyTickets();
  const held = (myTickets ?? []).filter(
    (ticket) => ticket.event_id === event.id && ticket.status === "valid",
  );
  const unavailable = unavailableReason(event, ticketing);
  const [gettingMore, setGettingMore] = useState(false);
  const form = <TicketForm event={event} ticketing={ticketing} held={held} />;

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
            {gettingMore && !unavailable ? form : null}
          </Stack>
        </CardContent>
        {gettingMore || unavailable ? null : (
          <CardFooter>
            <Button type="button" variant="outline" onClick={() => setGettingMore(true)}>
              {t("tickets.card.getAnother")}
            </Button>
          </CardFooter>
        )}
      </Card>
    );
  }

  return (
    <Card data-slot="event-ticket-card">
      <CardHeader>
        <CardTitle>{t("tickets.card.title")}</CardTitle>
        <CardDescription>{t("tickets.card.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {unavailable ? (
          <CardDescription>{t(`tickets.card.unavailable.${unavailable}`)}</CardDescription>
        ) : (
          form
        )}
      </CardContent>
    </Card>
  );
}

interface TicketFormProps extends EventTicketCardProps {
  /** The viewer's valid tickets to this event. */
  held: ApiTicketResponse[];
}

/**
 * Pick a tier and a date, then take a free ticket in one tap or pay for
 * paid ones through Stripe Checkout on the club's account.
 */
function TicketForm({ event, ticketing, held }: TicketFormProps) {
  const { t, i18n } = useTranslation();
  const { getSchoolTimezone } = useSchoolDirectory();
  const { profileCompleted } = useAuthState();
  const take = useTakeFreeTicket(event.id);
  const checkout = useTicketCheckout(event.id);
  const currency = ticketing.currency ?? "cad";
  const money = (cents: number) => formatCents(cents, currency, i18n.language);

  const openTiers = ticketing.tiers.filter((tier) => tier.open);
  const [tierId, setTierId] = useState(openTiers[0]?.id ?? "");
  const tier = openTiers.find((option) => option.id === tierId) ?? openTiers[0];
  const free = tier?.price_cents === 0;
  // A free ticket is one per person and date, whatever its tier.
  const heldFreeDates = new Set(
    held.filter((ticket) => !ticket.paid).map((ticket) => ticket.event_date_id),
  );
  const dates = ticketing.dates.filter(
    (date) => date.open && !(free && heldFreeDates.has(date.event_date_id)),
  );
  const [dateId, setDateId] = useState(dates[0]?.event_date_id ?? "");
  const date = dates.find((option) => option.event_date_id === dateId) ?? dates[0];
  const [quantity, setQuantity] = useState(1);
  const maxQuantity = Math.max(
    1,
    Math.min(tier?.maximum_per_order ?? 1, tier?.remaining ?? Number.POSITIVE_INFINITY),
  );
  const count = Math.min(quantity, maxQuantity);
  // Stay busy after a checkout starts too: the browser is already on its way to Stripe.
  const busy = take.isPending || checkout.isPending || checkout.isSuccess;

  const tierLabel = (option: ApiTicketTier) =>
    option.price_cents === 0 ? t("common.free") : money(option.price_cents);
  const left = (option: ApiTicketTier) =>
    option.remaining == null ? undefined : t("tickets.card.left", { count: option.remaining });

  if (!tier || !date) {
    return <CardDescription>{t("tickets.card.unavailable.soldOut")}</CardDescription>;
  }

  const getTicket = () => {
    if (busy) return;
    const choice = { eventDateId: date.event_date_id, tierId: tier.id };
    if (free) take.mutate(choice);
    else checkout.mutate({ ...choice, quantity: count });
  };
  const action = free
    ? t("tickets.card.getFree")
    : t("tickets.card.buy", { total: money(tier.price_cents * count) });

  return (
    <Stack gap={4}>
      {openTiers.length > 1 ? (
        <RadioOptionGroup
          name={`ticket-tier-${event.id}`}
          value={tier.id}
          onChange={setTierId}
          options={openTiers.map((option) => ({
            value: option.id,
            label: `${option.name} · ${tierLabel(option)}`,
            description: left(option),
          }))}
        />
      ) : (
        <CardDescription>
          {[tier.name, tierLabel(tier), left(tier)].filter(Boolean).join(" · ")}
        </CardDescription>
      )}
      {dates.length > 1 ? (
        <RadioOptionGroup
          name={`ticket-date-${event.id}`}
          value={date.event_date_id}
          onChange={setDateId}
          options={dates.map((option: TicketDate) => ({
            value: option.event_date_id,
            label: formatOccurrence(option, getSchoolTimezone(event.school), i18n.language),
          }))}
        />
      ) : null}
      {free ? null : (
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
      )}
      {profileCompleted ? (
        <LoadingButton type="button" isLoading={busy} onClick={getTicket}>
          {action}
        </LoadingButton>
      ) : (
        <EmailOtpForm
          school={event.school}
          requestCodeLabel={free ? action : t("tickets.card.continueToPayment")}
          actionLabel={free ? action : t("tickets.card.continueToPayment")}
          focusOnMount={false}
          onAuthenticated={getTicket}
        />
      )}
      <CardDescription>
        {t(free ? "tickets.card.checkInNote" : "tickets.card.payNote", {
          club: event.club ?? t("tickets.refund.theClub"),
        })}
      </CardDescription>
    </Stack>
  );
}

/** A ticket the viewer holds: its QR code, its tier and date, and the way out. */
function HeldTicket({ ticket, event }: { ticket: ApiTicketResponse; event: Event }) {
  const { t, i18n } = useTranslation();
  const { getSchoolTimezone } = useSchoolDirectory();
  return (
    <Stack gap={3} align="center">
      <Suspense fallback={<Skeleton className="size-56" />}>
        <TicketQr value={ticketUrl(ticket)} label={t("tickets.pass.qrLabel")} />
      </Suspense>
      <CardDescription>
        {ticket.tier_name} · {formatOccurrence(ticket, getSchoolTimezone(event.school), i18n.language)}
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
