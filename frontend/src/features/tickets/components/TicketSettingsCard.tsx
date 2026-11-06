import { useId, useState } from "react";
import NextLink from "next/link";
import { useTranslation } from "react-i18next";
import { useTicketingSettings } from "@/features/tickets/hooks/useTickets";
import { controlBox } from "@/shared/config/controlBox";
import { ROUTES } from "@/shared/constants/routes";
import type { ApiEventTicketingResponse } from "@/shared/generated";
import { toast } from "@/shared/hooks/use-toast";
import { FormActions, Stack } from "@/shared/layout";
import { Button } from "@/shared/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/shared/ui/field";
import { FormInput } from "@/shared/ui/form-field";
import { LoadingButton } from "@/shared/ui/loading-button";
import { RadioOptionGroup } from "@/shared/ui/radio-option-group";
import { Switch } from "@/shared/ui/switch";
import { formatCents } from "@/shared/utils/currency";

const { minimumPriceCents, maximumPriceCents, maximumCapacity } = controlBox.ticketing;

type Admission = "free" | "paid";

/** What the club can do with money: nothing yet, sell once payouts are set up, or sell now. */
export interface TicketPayouts {
  /** Paid tickets are switched on for wat2do at all. */
  available: boolean;
  /** The club's Stripe account takes payments. */
  ready: boolean;
  currency: string;
}

interface TicketSettingsCardProps {
  eventId: number;
  /** Null until the event has tickets. */
  ticketing: ApiEventTicketingResponse | null;
  /** Tickets ever given out or sold; the price locks once there is one. */
  issuedEver: number;
  payouts: TicketPayouts;
}

/** A typed price in cents, or null outside the allowed range; "12,50" counts as 12.50. */
function centsFromInput(value: string): number | null {
  const cents = Math.round(Number(value.trim().replace(",", ".")) * 100);
  return value.trim() && cents >= minimumPriceCents && cents <= maximumPriceCents ? cents : null;
}

/** Turn tickets on (free in one click), or change capacity, price and pausing. */
export function TicketSettingsCard({
  eventId,
  ticketing,
  issuedEver,
  payouts,
}: TicketSettingsCardProps) {
  const { t, i18n } = useTranslation();
  const pauseId = useId();
  const { save, stop } = useTicketingSettings(eventId);
  const [admission, setAdmission] = useState<Admission>(
    ticketing && ticketing.price_cents > 0 ? "paid" : "free",
  );
  const [price, setPrice] = useState(
    ticketing && ticketing.price_cents > 0 ? (ticketing.price_cents / 100).toFixed(2) : "",
  );
  const [capacity, setCapacity] = useState(ticketing?.capacity ? String(ticketing.capacity) : "");
  const [paused, setPaused] = useState(ticketing?.paused ?? false);

  const paid = admission === "paid";
  const currency = ticketing?.currency ?? payouts.currency;
  const priceCents = paid ? centsFromInput(price) : 0;
  const capacityValue = capacity ? Number(capacity) : null;
  const capacityValid =
    capacityValue === null || (capacityValue > 0 && capacityValue <= maximumCapacity);
  const priceLocked = ticketing !== null && issuedEver > 0;
  const canSave = capacityValid && priceCents !== null && (!paid || payouts.ready);
  // Only before anyone has a ticket can the event switch between free and paid.
  const canChooseAdmission = payouts.available && !priceLocked;

  const submit = () => {
    if (!canSave || priceCents === null) return;
    save.mutate(
      { price_cents: priceCents, capacity: capacityValue, paused },
      {
        onSuccess: () =>
          toast({
            description: ticketing
              ? t("tickets.desk.saved")
              : t(paid ? "tickets.desk.sellingStarted" : "tickets.desk.freeStarted"),
            variant: "success",
          }),
      },
    );
  };

  return (
    <Card data-slot="ticket-settings-card">
      <CardHeader>
        <CardTitle>{ticketing ? t("tickets.desk.settingsTitle") : t("tickets.desk.setupTitle")}</CardTitle>
        <CardDescription>
          {ticketing ? t("tickets.desk.settingsDescription") : t("tickets.desk.setupDescription")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Stack gap={4}>
          {canChooseAdmission ? (
            <RadioOptionGroup
              name={`ticket-admission-${eventId}`}
              value={admission}
              onChange={(value) => setAdmission(value as Admission)}
              options={[
                {
                  value: "free",
                  label: t("tickets.desk.free"),
                  description: t("tickets.desk.freeHint"),
                },
                {
                  value: "paid",
                  label: t("tickets.desk.paid"),
                  description: t("tickets.desk.paidHint"),
                },
              ]}
            />
          ) : null}
          {paid && !payouts.ready ? (
            <Stack gap={2} align="start">
              <CardDescription>{t("tickets.desk.payoutsNeeded")}</CardDescription>
              <Button variant="outline" asChild>
                <NextLink href={ROUTES.CLUB_PANEL_PAYOUTS}>{t("tickets.desk.setUpPayouts")}</NextLink>
              </Button>
            </Stack>
          ) : null}
          {paid ? (
            <>
              <FormInput
                name={`ticket-price-${eventId}`}
                label={t("tickets.desk.price", { currency: currency.toUpperCase() })}
                inputMode="decimal"
                prefix="$"
                required
                disabled={priceLocked || !payouts.ready}
                value={price}
                onChange={(value) => setPrice(String(value))}
                touched={price.trim() !== "" && priceCents === null}
                error={t("tickets.desk.priceRange", {
                  minimum: formatCents(minimumPriceCents, currency, i18n.language),
                  maximum: formatCents(maximumPriceCents, currency, i18n.language),
                })}
              />
              {priceLocked ? <FieldDescription>{t("tickets.desk.priceLocked")}</FieldDescription> : null}
            </>
          ) : null}
          <FormInput
            name={`ticket-capacity-${eventId}`}
            label={t("tickets.desk.capacity")}
            format="integer"
            placeholder={t("tickets.desk.capacityPlaceholder")}
            value={capacity}
            onChange={(value) => setCapacity(String(value))}
            touched={!capacityValid}
            error={t("tickets.desk.capacityRange", { maximum: maximumCapacity })}
          />
          {ticketing ? (
            <Field orientation="horizontal">
              <Stack gap={1}>
                <FieldLabel htmlFor={pauseId}>{t("tickets.desk.pause")}</FieldLabel>
                <FieldDescription>{t("tickets.desk.pauseHint")}</FieldDescription>
              </Stack>
              <Switch id={pauseId} checked={paused} onCheckedChange={setPaused} />
            </Field>
          ) : null}
          <CardDescription>
            {paid ? t("tickets.desk.fees") : ticketing ? null : t("tickets.desk.goingNote")}
          </CardDescription>
        </Stack>
      </CardContent>
      <CardFooter>
        <FormActions align="between">
          <LoadingButton type="button" disabled={!canSave} isLoading={save.isPending} onClick={submit}>
            {ticketing
              ? t("tickets.desk.save")
              : paid
                ? t("tickets.desk.startSelling")
                : t("tickets.desk.turnOnFree")}
          </LoadingButton>
          {ticketing && issuedEver === 0 ? (
            <Button
              type="button"
              variant="ghost"
              disabled={stop.isPending}
              onClick={() =>
                stop.mutate(undefined, {
                  onSuccess: () => toast({ description: t("tickets.desk.turnedOff") }),
                })
              }
            >
              {t("tickets.desk.turnOff")}
            </Button>
          ) : null}
        </FormActions>
      </CardFooter>
    </Card>
  );
}
