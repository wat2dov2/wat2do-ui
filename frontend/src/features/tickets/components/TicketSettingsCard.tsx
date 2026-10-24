import { useId, useState } from "react";
import NextLink from "next/link";
import { useTranslation } from "react-i18next";
import { useTicketingSettings } from "@/features/tickets/hooks/useTickets";
import type { ApiEventTicketingResponse } from "@/shared/generated";
import { controlBox } from "@/shared/config/controlBox";
import { ROUTES } from "@/shared/constants/routes";
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
import { Switch } from "@/shared/ui/switch";
import { toast } from "@/shared/hooks/use-toast";
import { formatCents } from "@/shared/utils/currency";

const { minimumPriceCents, maximumPriceCents, maximumCapacity } = controlBox.ticketing;

interface TicketSettingsCardProps {
  eventId: number;
  /** Null until the event sells tickets. */
  ticketing: ApiEventTicketingResponse | null;
  currency: string;
  /** Tickets ever sold; the price locks once this is above zero. */
  sold: number;
  payoutsReady: boolean;
}

/** A typed price in cents, or null outside the allowed range; "12,50" counts as 12.50. */
function centsFromInput(value: string): number | null {
  const cents = Math.round(Number(value.trim().replace(",", ".")) * 100);
  return value.trim() && cents >= minimumPriceCents && cents <= maximumPriceCents ? cents : null;
}

/** Start selling, or change price, capacity and pausing for an event that already sells. */
export function TicketSettingsCard({
  eventId,
  ticketing,
  currency,
  sold,
  payoutsReady,
}: TicketSettingsCardProps) {
  const { t, i18n } = useTranslation();
  const pauseId = useId();
  const { save, stop } = useTicketingSettings(eventId);
  const [price, setPrice] = useState(ticketing ? (ticketing.price_cents / 100).toFixed(2) : "");
  const [capacity, setCapacity] = useState(ticketing?.capacity ? String(ticketing.capacity) : "");
  const [paused, setPaused] = useState(ticketing?.sales_paused ?? false);

  const priceCents = centsFromInput(price);
  const capacityValue = capacity ? Number(capacity) : null;
  const capacityValid = capacityValue === null || (capacityValue > 0 && capacityValue <= maximumCapacity);
  const priceLocked = ticketing !== null && sold > 0;
  const canSave = payoutsReady && priceCents !== null && capacityValid;

  const submit = () => {
    if (!canSave || priceCents === null) return;
    save.mutate(
      { price_cents: priceCents, capacity: capacityValue, sales_paused: paused },
      { onSuccess: () => toast({ description: t("tickets.desk.saved"), variant: "success" }) },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{ticketing ? t("tickets.desk.settingsTitle") : t("tickets.desk.setupTitle")}</CardTitle>
        <CardDescription>
          {ticketing ? t("tickets.desk.settingsDescription") : t("tickets.desk.setupDescription")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Stack gap={4}>
          {payoutsReady ? null : (
            <Stack gap={2} align="start">
              <CardDescription>{t("tickets.desk.payoutsNeeded")}</CardDescription>
              <Button variant="outline" asChild>
                <NextLink href={ROUTES.CLUB_PANEL_PAYOUTS}>{t("tickets.desk.setUpPayouts")}</NextLink>
              </Button>
            </Stack>
          )}
          <FormInput
            name={`ticket-price-${eventId}`}
            label={t("tickets.desk.price", { currency: currency.toUpperCase() })}
            inputMode="decimal"
            prefix="$"
            required
            disabled={priceLocked || !payoutsReady}
            value={price}
            onChange={(value) => setPrice(String(value))}
            touched={price.trim() !== "" && priceCents === null}
            error={t("tickets.desk.priceRange", {
              minimum: formatCents(minimumPriceCents, currency, i18n.language),
              maximum: formatCents(maximumPriceCents, currency, i18n.language),
            })}
          />
          {priceLocked ? <FieldDescription>{t("tickets.desk.priceLocked")}</FieldDescription> : null}
          <FormInput
            name={`ticket-capacity-${eventId}`}
            label={t("tickets.desk.capacity")}
            format="integer"
            disabled={!payoutsReady}
            placeholder={t("tickets.desk.capacityPlaceholder")}
            value={capacity}
            onChange={(value) => setCapacity(String(value))}
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
          <CardDescription>{t("tickets.desk.fees")}</CardDescription>
        </Stack>
      </CardContent>
      <CardFooter>
        <FormActions align="between">
          <LoadingButton type="button" disabled={!canSave} isLoading={save.isPending} onClick={submit}>
            {ticketing ? t("tickets.desk.save") : t("tickets.desk.startSelling")}
          </LoadingButton>
          {ticketing && sold === 0 ? (
            <Button
              type="button"
              variant="ghost"
              disabled={stop.isPending}
              onClick={() =>
                stop.mutate(undefined, {
                  onSuccess: () => toast({ description: t("tickets.desk.stopped") }),
                })
              }
            >
              {t("tickets.desk.stopSelling")}
            </Button>
          ) : null}
        </FormActions>
      </CardFooter>
    </Card>
  );
}
