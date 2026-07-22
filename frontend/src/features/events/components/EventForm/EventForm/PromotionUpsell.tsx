import { Coins, X } from "@/shared/ui/doodle-icons";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/shared/ui/drawer";
import { EVENT_PROMOTION } from "@/shared/constants/promotions";
import { useEventFormContext } from "@/features/events/components/EventForm/EventForm/EventFormContext";

interface PromotionUpsellProps {
  isOpen: boolean;
  onClose: () => void;
  onPromote: () => void;
  onBuyCredits: () => void;
  userCredits: number;
}

export function PromotionUpsell({
  isOpen,
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
    <Drawer open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent className="overflow-hidden p-0">
        <DrawerClose asChild>
          <button
            type="button"
            className="absolute right-3 top-3 z-20 flex size-9 items-center justify-center rounded-xl bg-background/90 text-foreground opacity-80 shadow-sm transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            aria-label={t("common.close")}
          >
            <X className="size-4" />
          </button>
        </DrawerClose>
        <div className="mx-auto w-full max-w-md px-4 pb-4 pt-5 sm:px-6 sm:pb-6 sm:pt-6">
          <DrawerHeader className="px-10 pt-0 text-center">
            <DrawerTitle>{t("promotion.promoteEvent")}</DrawerTitle>
            <DrawerDescription>
              {t("promotion.getMoreVisibility", { title: formData.title })}
            </DrawerDescription>
          </DrawerHeader>

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
                variant="secondary"
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

            <DrawerFooter className="p-0 sm:flex-row">
              <DrawerClose asChild>
                <Button variant="secondary" className="flex-1">
                  {t("promotion.maybeLater")}
                </Button>
              </DrawerClose>
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
            </DrawerFooter>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
