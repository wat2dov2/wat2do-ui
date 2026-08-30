import { Coins, X } from "@/shared/ui/doodle-icons";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/button";
import { EVENT_PROMOTION } from "@/shared/constants/promotions";
import { useEventFormContext } from "@/features/events/components/EventForm/EventForm/EventFormContext";
import { Section, Stack } from "@/shared/layout";

interface PromotionUpsellProps {
  onClose: () => void;
  onPromote: () => void;
  onBuyCredits: () => void;
  userCredits: number;
}

export function PromotionUpsell({
  onClose,
  onPromote,
  onBuyCredits,
  userCredits,
}: PromotionUpsellProps) {
  const { formData } = useEventFormContext();
  const { t } = useTranslation();
  const promotion = EVENT_PROMOTION;
  const canAfford = userCredits >= promotion.credits;

  return (
    <Section variant="surface" className="relative mx-auto w-full max-w-md">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onClose}
        className="absolute right-3 top-3"
        aria-label={t("common.close")}
      >
        <X className="size-4" />
      </Button>
      <Stack gap={1} className="px-10 text-center">
        <h2 className="text-xl font-semibold text-foreground">
          {t("promotion.promoteEvent")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("promotion.getMoreVisibility", { title: formData.title })}
        </p>
      </Stack>

      <div className="space-y-4 py-2">
        <div className="flex items-center justify-between rounded-lg bg-warning/20 px-4 py-2">
          <div className="flex items-center gap-2">
            <Coins className="size-5 text-warning" />
            <span className="font-semibold text-warning">
              {t("credits.creditCount", { count: userCredits })}
            </span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onMouseDown={onBuyCredits}
            className="h-auto p-0 text-xs font-medium text-warning hover:text-warning/80"
          >
            {t("credits.buyMore")}
          </Button>
        </div>

        <div className="space-y-3 rounded-lg border border-border p-4">
          <div>
            <p className="font-semibold text-foreground">{t(promotion.nameKey)}</p>
            <p className="text-sm text-muted-foreground">{t(promotion.descriptionKey)}</p>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {t("promotion.durationDays", { count: promotion.duration })}
            </span>
            <span className="inline-flex items-center gap-1 font-semibold text-foreground">
              <Coins className="size-4 text-warning" />
              {t("promotion.creditsCost", { credits: promotion.credits })}
            </span>
          </div>
          {!canAfford && (
            <p className="text-xs text-destructive">{t("promotion.notEnoughCredits")}</p>
          )}
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose} className="flex-1">
            {t("promotion.maybeLater")}
          </Button>
          <Button
            onMouseDown={onPromote}
            disabled={!canAfford}
            className="flex-1 bg-primary hover:bg-primary-hover"
          >
            <span className="flex items-center gap-1.5">
              <Coins className="size-4" />
              {t("promotion.spendCredits", { credits: promotion.credits })}
            </span>
          </Button>
        </div>
      </div>
    </Section>
  );
}
