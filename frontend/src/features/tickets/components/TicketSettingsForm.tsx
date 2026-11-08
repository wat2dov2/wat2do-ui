import NextLink from "next/link";
import { useTranslation } from "react-i18next";
import { useTicketingSettings } from "@/features/tickets/hooks/useTickets";
import { useTicketSettingsForm } from "@/features/tickets/hooks/useTicketSettingsForm";
import { controlBox } from "@/shared/config/controlBox";
import { ROUTES } from "@/shared/constants/routes";
import type { ApiEventTicketingResponse } from "@/shared/generated";
import { toast } from "@/shared/hooks/use-toast";
import { FormActions, FormGrid, FormLayout, FormSection, Stack } from "@/shared/layout";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { FieldDescription } from "@/shared/ui/field";
import { FormInput } from "@/shared/ui/form-field";
import { LoadingButton } from "@/shared/ui/loading-button";
import { SwitchField } from "@/shared/ui/switch-field";
import { formatCents } from "@/shared/utils/currency";
import { Plus, Trash2 } from "lucide-react";

const { minimumPriceCents, maximumPriceCents, maximumCapacity } = controlBox.ticketing;

/** What the club can do with money: nothing yet, sell once payouts are set up, or sell now. */
export interface TicketPayouts {
  /** Paid tickets are switched on for wat2do at all. */
  available: boolean;
  /** The club's Stripe account takes payments. */
  ready: boolean;
  currency: string;
}

interface TicketSettingsFormProps {
  eventId: number;
  /** Null while the event has no tickets: the form sets them up. */
  ticketing: ApiEventTicketingResponse | null;
  /** Tiers people already hold tickets of: they stay, at their price. */
  lockedTierIds: ReadonlySet<string>;
  /** Tickets ever given out or sold; tickets can be turned off only before the first. */
  issuedEver: number;
  payouts: TicketPayouts;
  /** Where the club goes once the settings are saved, or tickets turned off. */
  onDone: () => void;
  cancelHref: string;
}

/** Set up an event's tickets, or change them: one limit, the tiers, and pausing. */
export function TicketSettingsForm({
  eventId,
  ticketing,
  lockedTierIds,
  issuedEver,
  payouts,
  onDone,
  cancelHref,
}: TicketSettingsFormProps) {
  const { t, i18n } = useTranslation();
  const form = useTicketSettingsForm(ticketing);
  const { save, stop } = useTicketingSettings(eventId);
  const currency = ticketing?.currency ?? payouts.currency;
  const money = (cents: number) => formatCents(cents, currency, i18n.language);
  // A price takes money only through the club's own Stripe account.
  const needsPayouts = form.paid && !payouts.ready;
  const setsUp = ticketing === null;

  const submit = () => {
    const settings = form.submit();
    if (!settings || needsPayouts || save.isPending) return;
    save.mutate(settings, {
      onSuccess: () => {
        toast({
          description: setsUp ? t("tickets.settings.published") : t("tickets.settings.saved"),
          variant: "success",
        });
        onDone();
      },
    });
  };

  const turnOff = () =>
    stop.mutate(undefined, {
      onSuccess: () => {
        toast({ description: t("tickets.settings.turnedOff") });
        onDone();
      },
    });

  return (
    <FormLayout
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <FormSection
        title={t("tickets.settings.tiersTitle")}
        description={t("tickets.settings.tiersDescription")}
      >
        <Stack gap={4}>
          {form.tiers.map((tier, index) => {
            const locked = tier.id !== null && lockedTierIds.has(tier.id);
            const problems = form.problems[index];
            return (
              <Card key={tier.key} data-slot="ticket-tier">
                <CardHeader>
                  <CardTitle>{t("tickets.settings.tierNumber", { number: index + 1 })}</CardTitle>
                  {form.tiers.length > 1 && !locked ? (
                    <CardAction>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t("tickets.settings.removeTier", { number: index + 1 })}
                        onClick={() => form.removeTier(tier.key)}
                      >
                        <Trash2 />
                      </Button>
                    </CardAction>
                  ) : null}
                </CardHeader>
                <CardContent>
                  <Stack gap={3}>
                    <FormGrid columns={3}>
                      <FormInput
                        name={`ticket-tier-name-${tier.key}`}
                        label={t("tickets.settings.tierName")}
                        required
                        value={tier.name}
                        placeholder={t("tickets.settings.defaultTierName")}
                        onChange={(value) => form.updateTier(tier.key, { name: String(value) })}
                        touched={Boolean(problems.name)}
                        error={
                          problems.name === "repeated"
                            ? t("tickets.settings.nameRepeated")
                            : t("tickets.settings.nameRequired")
                        }
                      />
                      <FormInput
                        name={`ticket-tier-price-${tier.key}`}
                        label={t("tickets.settings.tierPrice", { currency: currency.toUpperCase() })}
                        inputMode="decimal"
                        prefix="$"
                        placeholder={t("common.free")}
                        disabled={locked || !payouts.available}
                        value={tier.price}
                        onChange={(value) => form.updateTier(tier.key, { price: String(value) })}
                        touched={problems.price}
                        error={t("tickets.settings.priceRange", {
                          minimum: money(minimumPriceCents),
                          maximum: money(maximumPriceCents),
                        })}
                      />
                      <FormInput
                        name={`ticket-tier-capacity-${tier.key}`}
                        label={t("tickets.settings.tierLimit")}
                        format="integer"
                        placeholder={t("tickets.settings.noLimit")}
                        value={tier.capacity}
                        onChange={(value) => form.updateTier(tier.key, { capacity: String(value) })}
                        touched={problems.capacity}
                        error={t("tickets.settings.limitRange", { maximum: maximumCapacity })}
                      />
                    </FormGrid>
                    {locked ? (
                      <FieldDescription>{t("tickets.settings.tierLocked")}</FieldDescription>
                    ) : null}
                  </Stack>
                </CardContent>
              </Card>
            );
          })}
          {form.canAddTier ? (
            <Stack align="start">
              <Button type="button" variant="outline" onClick={form.addTier}>
                <Plus />
                {t("tickets.settings.addTier")}
              </Button>
            </Stack>
          ) : null}
          {payouts.available ? null : (
            <FieldDescription>{t("tickets.settings.paidComingSoon")}</FieldDescription>
          )}
          {needsPayouts ? (
            <Alert>
              <AlertDescription>
                <Stack gap={2} align="start">
                  <p>{t("tickets.settings.payoutsNeeded")}</p>
                  <Button variant="outline" size="sm" asChild>
                    <NextLink href={ROUTES.CLUB_PANEL_PAYOUTS}>
                      {t("tickets.settings.setUpPayouts")}
                    </NextLink>
                  </Button>
                </Stack>
              </AlertDescription>
            </Alert>
          ) : form.paid ? (
            <FieldDescription>{t("tickets.settings.fees")}</FieldDescription>
          ) : null}
        </Stack>
      </FormSection>

      <FormSection
        title={t("tickets.settings.limitTitle")}
        description={t("tickets.settings.limitDescription")}
      >
        <FormInput
          name={`ticket-capacity-${eventId}`}
          label={t("tickets.settings.limitLabel")}
          format="integer"
          placeholder={t("tickets.settings.noLimit")}
          value={form.capacity}
          onChange={(value) => form.setCapacity(String(value))}
          touched={form.capacityInvalid}
          error={t("tickets.settings.limitRange", { maximum: maximumCapacity })}
        />
      </FormSection>

      {setsUp ? (
        form.tiers.length === 1 && !form.paid ? (
          <FieldDescription>{t("tickets.settings.goingNote")}</FieldDescription>
        ) : null
      ) : (
        <SwitchField
          label={t("tickets.settings.pause")}
          description={t("tickets.settings.pauseHint")}
          checked={form.paused}
          onCheckedChange={form.setPaused}
        />
      )}

      <FormActions align="between">
        <Stack direction="horizontal" gap={3} wrap>
          <LoadingButton type="submit" isLoading={save.isPending}>
            {setsUp ? t("tickets.settings.publish") : t("tickets.settings.save")}
          </LoadingButton>
          <Button variant="ghost" asChild>
            <NextLink href={cancelHref}>{t("tickets.settings.cancel")}</NextLink>
          </Button>
        </Stack>
        {!setsUp && issuedEver === 0 ? (
          <LoadingButton
            type="button"
            variant="ghost"
            isLoading={stop.isPending}
            onClick={turnOff}
          >
            {t("tickets.settings.turnOff")}
          </LoadingButton>
        ) : null}
      </FormActions>
    </FormLayout>
  );
}
