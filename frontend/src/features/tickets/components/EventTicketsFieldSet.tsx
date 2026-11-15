import { useId } from "react";
import NextLink from "next/link";
import { Trans, useTranslation } from "react-i18next";
import { Plus, QrCode, Trash2 } from "lucide-react";
import clubPayouts from "../../../../../backend/controlbox/club_payouts.json" with { type: "json" };
import {
  useClubPayouts,
  useEventTicketing,
  useTicketDesk,
  useTicketsClub,
} from "@/features/tickets/hooks/useTickets";
import {
  eventTicketsErrors,
  newTicketRelease,
  ticketPriceCents,
  type TicketReleaseErrors,
} from "@/features/tickets/lib/eventTicketsForm";
import { buildEventOccurrence } from "@/shared/api/eventPayload";
import { controlBox } from "@/shared/config/controlBox";
import { ROUTES, clubPanelEventTicketsPath } from "@/shared/constants/routes";
import { FormGrid, Stack } from "@/shared/layout";
import { useUIStore } from "@/shared/store/ui.store";
import type { EventFormData, EventFormTicketRelease, EventFormTickets } from "@/shared/types";
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
import { FormDateTimePicker, FormInput } from "@/shared/ui/form-field";
import { Link } from "@/shared/ui/link";
import { Switch } from "@/shared/ui/switch";
import { formatCents } from "@/shared/utils/currency";
import { formatOccurrence } from "@/shared/utils/date";

const { minimumPriceCents, maximumPriceCents, maximumCapacity, maximumReleases } = controlBox.ticketing;

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
 * dates have tickets, the releases they go on sale in (each with when, how
 * many per date and a price, empty for free) and pausing. Only the club's
 * team sees it.
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
  // People holding tickets keep them: pausing replaces turning them off.
  const held = savedTickets !== null && issuedEver > 0;
  const paidAvailable = Boolean(payouts.data?.paid_tickets_enabled);
  const canCharge = Boolean(payouts.data?.charges_enabled);
  const currency = savedTickets?.currency ?? payouts.data?.currency ?? "cad";
  const paidReleases = tickets.releases.some((release) => (ticketPriceCents(release.price) ?? 0) > 0);
  // People holding a release's tickets keep it, at its price.
  const lockedReleases = new Set(
    (savedTickets?.releases ?? []).filter((release) => release.has_tickets).map((release) => release.id),
  );
  const datedOccurrences = occurrences
    .map((occurrence, index) => ({ occurrence, index }))
    .filter(({ occurrence }) => occurrence.dtstart_local);
  const ticketedDates = datedOccurrences.filter(({ occurrence }) => occurrence.tickets).length;
  const setEnabled = (enabled: boolean) =>
    update({
      enabled,
      // Turning tickets on starts with one release, on sale now.
      releases: enabled && !tickets.releases.length ? [newTicketRelease(timeZone, new Date())] : tickets.releases,
    });
  const updateRelease = (index: number, change: Partial<EventFormTicketRelease>) =>
    update({
      releases: tickets.releases.map((release, current) => (current === index ? { ...release, ...change } : release)),
    });
  const addRelease = () =>
    update({ releases: [...tickets.releases, newTicketRelease(timeZone, null)] });
  const removeRelease = (index: number) =>
    update({ releases: tickets.releases.filter((_, current) => current !== index) });
  const releaseError = (errors: TicketReleaseErrors | undefined) => ({
    onSale:
      errors?.onSale === "sameTime" ? t("tickets.desk.sameTime") : errors?.onSale ? t("tickets.desk.onSaleRequired") : undefined,
    quantity:
      errors?.quantity === "unlimitedNotLast"
        ? t("tickets.desk.unlimitedNotLast")
        : errors?.quantity
          ? t("tickets.desk.capacityRange", { maximum: maximumCapacity })
          : undefined,
    price:
      errors?.price === "mixed"
        ? t("tickets.desk.mixedPrices")
        : errors?.price
          ? t("tickets.desk.priceRange", {
              minimum: formatCents(minimumPriceCents, currency, i18n.language),
              maximum: formatCents(maximumPriceCents, currency, i18n.language),
            })
          : undefined,
  });

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
              onCheckedChange={setEnabled}
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

              <Field data-slot="ticket-releases">
                <FieldLabel>{t("tickets.desk.releases")}</FieldLabel>
                <FieldDescription>{t("tickets.desk.releasesHint")}</FieldDescription>
                <FieldDescription>{timeZone}</FieldDescription>
                <FieldGroup>
                  {tickets.releases.map((release, index) => {
                    const locked = release.id != null && lockedReleases.has(release.id);
                    const error = releaseError(errors.releases?.[index]);
                    return (
                      <Stack key={release.id ?? `new-${index}`} gap={2}>
                        <FormGrid columns={paidAvailable ? "threeWithAction" : "withAction"}>
                          <FormDateTimePicker
                            name={`ticket-release-${index}-on-sale`}
                            label={t("tickets.desk.onSale")}
                            required
                            value={release.on_sale_local}
                            onChange={(on_sale_local) => updateRelease(index, { on_sale_local })}
                            touched={Boolean(error.onSale)}
                            error={error.onSale}
                          />
                          <FormInput
                            name={`ticket-release-${index}-quantity`}
                            label={t(ticketedDates > 1 ? "tickets.desk.quantityPerDate" : "tickets.desk.quantity")}
                            format="integer"
                            placeholder={t("tickets.desk.capacityPlaceholder")}
                            value={release.quantity}
                            onChange={(value) => updateRelease(index, { quantity: String(value) })}
                            touched={Boolean(error.quantity)}
                            error={error.quantity}
                          />
                          {paidAvailable ? (
                            <FormInput
                              name={`ticket-release-${index}-price`}
                              label={t("tickets.desk.price", { currency: currency.toUpperCase() })}
                              inputMode="decimal"
                              prefix="$"
                              placeholder={t("common.free")}
                              disabled={locked || !canCharge}
                              value={release.price}
                              onChange={(value) => updateRelease(index, { price: String(value) })}
                              touched={Boolean(error.price)}
                              error={error.price}
                            />
                          ) : null}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onMouseDown={() => removeRelease(index)}
                            disabled={locked || tickets.releases.length === 1}
                            aria-label={t("tickets.desk.removeRelease")}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </FormGrid>
                        {locked ? <FieldDescription>{t("tickets.desk.releaseLocked")}</FieldDescription> : null}
                      </Stack>
                    );
                  })}
                </FieldGroup>
                {tickets.releases.length < maximumReleases ? (
                  <Stack align="start">
                    <Button type="button" variant="outline" size="sm" onMouseDown={addRelease}>
                      <Plus className="size-4" />
                      {t("tickets.desk.addRelease")}
                    </Button>
                  </Stack>
                ) : null}
              </Field>
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
              {paidReleases ? <FieldDescription>{t("tickets.desk.fees")}</FieldDescription> : null}

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
