import { useId } from "react";
import NextLink from "next/link";
import { Trans, useTranslation } from "react-i18next";
import { QrCode } from "lucide-react";
import clubPayouts from "../../../../../backend/controlbox/club_payouts.json" with { type: "json" };
import { useAuthState } from "@/features/auth";
import {
  useClubPayouts,
  useEventTicketing,
  useTicketDesk,
} from "@/features/tickets/hooks/useTickets";
import {
  eventTicketsErrors,
  ticketPriceCents,
} from "@/features/tickets/lib/eventTicketsForm";
import { buildEventOccurrence } from "@/shared/api/eventPayload";
import { controlBox } from "@/shared/config/controlBox";
import { ROUTES, clubPanelEventTicketsPath } from "@/shared/constants/routes";
import { FormGrid, Stack } from "@/shared/layout";
import { useUIStore } from "@/shared/store/ui.store";
import type { EventFormData, EventFormTickets } from "@/shared/types";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
  FieldSet,
} from "@/shared/ui/field";
import { FormInput } from "@/shared/ui/form-field";
import { Link } from "@/shared/ui/link";
import { Switch } from "@/shared/ui/switch";
import { formatCents } from "@/shared/utils/currency";
import { formatOccurrence } from "@/shared/utils/date";

const { minimumPriceCents, maximumPriceCents, maximumCapacity } = controlBox.ticketing;

/** The club the form's event belongs to, when the viewer is on its team: only its team sets tickets. */
export function useTicketsClub(clubId: number | null) {
  const { clubs } = useAuthState();
  return clubs.find((club) => club.id === clubId) ?? null;
}

interface EventTicketsFieldSetProps {
  /** The saved event being edited; null while it is new. */
  eventId: number | null;
  formData: EventFormData;
  onTicketsChange: (tickets: EventFormTickets) => void;
  onDateTicketsChange: (index: number, tickets: boolean) => void;
  /** Show what stops the tickets from saving, after a save was tried. */
  showErrors: boolean;
}

/**
 * The event's tickets in its own form: one switch, and once it is on, which
 * dates have tickets, the price (empty is free), the limit and pausing.
 * Only the club's team sees it.
 */
export function EventTicketsFieldSet({
  eventId,
  formData,
  onTicketsChange,
  onDateTicketsChange,
  showErrors,
}: EventTicketsFieldSetProps) {
  const { t, i18n } = useTranslation();
  const switchId = useId();
  const pauseId = useId();
  const club = useTicketsClub(formData.club_id);
  const payouts = useClubPayouts(club?.id);
  const saved = useEventTicketing(eventId);
  const desk = useTicketDesk(eventId ?? 0, Boolean(saved.data));
  const clearEditingEvent = useUIStore((state) => state.clearEditingEvent);
  if (!club) return null;

  const { tickets, occurrences, timeZone } = formData;
  const update = (change: Partial<EventFormTickets>) => onTicketsChange({ ...tickets, ...change });
  const errors = showErrors ? eventTicketsErrors(formData) : {};
  const savedTickets = saved.data ?? null;
  const issuedEver = (desk.data?.issued ?? 0) + (desk.data?.refunded ?? 0);
  // People holding tickets keep them: the price stays, and pausing replaces turning them off.
  const held = savedTickets !== null && issuedEver > 0;
  const paidAvailable = Boolean(payouts.data?.paid_tickets_enabled);
  const canCharge = Boolean(payouts.data?.charges_enabled);
  const currency = savedTickets?.currency ?? payouts.data?.currency ?? "cad";
  const priceCents = ticketPriceCents(tickets.price);
  const datedOccurrences = occurrences
    .map((occurrence, index) => ({ occurrence, index }))
    .filter(({ occurrence }) => occurrence.dtstart_local);

  return (
    <>
      <FieldSet data-slot="event-tickets">
        <FieldGroup>
          <Field orientation="horizontal">
            <Stack gap={1}>
              <FieldLabel htmlFor={switchId}>{t("tickets.desk.title")}</FieldLabel>
              <FieldDescription>{t("tickets.desk.setupDescription")}</FieldDescription>
              {/* Turning tickets on is how a club accepts the payout terms, so they sit by the switch. */}
              {club.school && clubPayouts.schools.includes(club.school) ? (
                <FieldDescription>
                  <Trans
                    t={t}
                    i18nKey={savedTickets ? "tickets.desk.payoutNote" : "tickets.desk.payoutNoteSetup"}
                    values={{ rate: formatCents(clubPayouts.rate_cents, clubPayouts.currency, i18n.language) }}
                    components={{ terms: <Link href={ROUTES.CLUB_PAYOUT_TERMS} target="_blank" /> }}
                  />
                </FieldDescription>
              ) : null}
              {held ? <FieldDescription>{t("tickets.desk.turnOffLocked")}</FieldDescription> : null}
            </Stack>
            <Switch
              id={switchId}
              checked={tickets.enabled}
              disabled={held}
              onCheckedChange={(enabled) => update({ enabled })}
            />
          </Field>

          {tickets.enabled ? (
            <>
              {datedOccurrences.length > 1 ? (
                <Field data-invalid={errors.dates ? true : undefined}>
                  <FieldLabel>{t("tickets.desk.dates")}</FieldLabel>
                  {datedOccurrences.map(({ occurrence, index }) => {
                    const id = `${switchId}-date-${index}`;
                    return (
                      <Field key={index} orientation="horizontal-start">
                        <Checkbox
                          id={id}
                          checked={occurrence.tickets}
                          onCheckedChange={(checked) => onDateTicketsChange(index, checked === true)}
                        />
                        <FieldLabel htmlFor={id}>
                          {formatOccurrence(buildEventOccurrence(occurrence, timeZone), timeZone, i18n.language)}
                        </FieldLabel>
                      </Field>
                    );
                  })}
                  {errors.dates ? <FieldError>{t("tickets.desk.datesRequired")}</FieldError> : null}
                </Field>
              ) : null}

              <FormGrid>
                {paidAvailable ? (
                  <FormInput
                    name="ticket-price"
                    label={t("tickets.desk.price", { currency: currency.toUpperCase() })}
                    inputMode="decimal"
                    prefix="$"
                    placeholder={t("common.free")}
                    disabled={held || !canCharge}
                    value={tickets.price}
                    onChange={(value) => update({ price: String(value) })}
                    touched={tickets.price.trim() !== "" && priceCents === null}
                    error={t("tickets.desk.priceRange", {
                      minimum: formatCents(minimumPriceCents, currency, i18n.language),
                      maximum: formatCents(maximumPriceCents, currency, i18n.language),
                    })}
                  />
                ) : null}
                <FormInput
                  name="ticket-capacity"
                  label={t("tickets.desk.capacity")}
                  format="integer"
                  placeholder={t("tickets.desk.capacityPlaceholder")}
                  value={tickets.capacity}
                  onChange={(value) => update({ capacity: String(value) })}
                  touched={Boolean(errors.capacity)}
                  error={t("tickets.desk.capacityRange", { maximum: maximumCapacity })}
                />
              </FormGrid>
              {paidAvailable && held ? <FieldDescription>{t("tickets.desk.priceLocked")}</FieldDescription> : null}
              {paidAvailable && !canCharge && !held ? (
                <Stack gap={2} align="start">
                  <FieldDescription>{t("tickets.desk.payoutsNeeded")}</FieldDescription>
                  <Button variant="outline" size="sm" asChild>
                    <NextLink href={ROUTES.CLUB_PANEL_PAYOUTS} onClick={clearEditingEvent}>
                      {t("tickets.desk.setUpPayouts")}
                    </NextLink>
                  </Button>
                </Stack>
              ) : null}
              {priceCents ? <FieldDescription>{t("tickets.desk.fees")}</FieldDescription> : null}

              {savedTickets ? (
                <>
                  <Field orientation="horizontal">
                    <Stack gap={1}>
                      <FieldLabel htmlFor={pauseId}>{t("tickets.desk.pause")}</FieldLabel>
                      <FieldDescription>{t("tickets.desk.pauseHint")}</FieldDescription>
                    </Stack>
                    <Switch
                      id={pauseId}
                      checked={tickets.paused}
                      onCheckedChange={(paused) => update({ paused })}
                    />
                  </Field>
                  {eventId != null ? (
                    <Stack align="start">
                      <Button variant="outline" size="sm" asChild>
                        <NextLink href={clubPanelEventTicketsPath(eventId)} onClick={clearEditingEvent}>
                          <QrCode className="size-4" />
                          {t("tickets.desk.openDesk")}
                        </NextLink>
                      </Button>
                    </Stack>
                  ) : null}
                </>
              ) : null}
            </>
          ) : null}
        </FieldGroup>
      </FieldSet>
      <FieldSeparator />
    </>
  );
}
