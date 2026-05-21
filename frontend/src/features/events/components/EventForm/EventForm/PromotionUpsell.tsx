import { Coins } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/shared/ui/dialog";
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
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md" showCloseButton={true}>
        <DialogHeader>
          <DialogTitle>{t("promotion.promoteEvent")}</DialogTitle>
          <DialogDescription>
            {t("promotion.getMoreVisibility", { title: formData.title })}
          </DialogDescription>
        </DialogHeader>

        <div className="py-2 space-y-4">
          <div className="flex items-center justify-between bg-warning/20 px-4 py-2 rounded-lg">
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
              onClick={onBuyCredits}
              className="text-xs font-medium text-warning hover:text-warning/80 h-auto p-0"
            >
              {t("credits.buyMore")}
            </Button>
          </div>

          <div className="rounded-lg border border-border p-4 space-y-3">
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
              <p className="text-xs text-error">{t("promotion.notEnoughCredits")}</p>
            )}
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" className="flex-1">
                {t("promotion.maybeLater")}
              </Button>
            </DialogClose>
            <Button
              onClick={onPromote}
              disabled={!canAfford}
              className="flex-1 bg-primary hover:bg-primary/90"
            >
              <span className="flex items-center gap-1.5">
                <Coins className="size-4" />
                {t("promotion.spendCredits", { credits: promotion.credits })}
              </span>
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
