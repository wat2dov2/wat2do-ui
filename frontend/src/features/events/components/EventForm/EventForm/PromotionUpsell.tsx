import React from "react";
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
import { PROMOTION_PACKAGES } from "@/shared/types";
import {
  PackageCard,
  PackageBadge,
  RadioButton,
  CreditsDisplay,
} from "@/features/events/components/EventForm/EventForm/PromotionUpsell.components";
import { useEventFormContext } from "@/features/events/components/EventForm/EventForm/EventFormContext";

interface PromotionUpsellProps {
  isOpen: boolean;
  onClose: () => void;
  onPromote: () => void;
  onBuyCredits: () => void;
  userCredits: number;
  selectedPromotion: string | null;
  onSelectPromotion: (packageId: string) => void;
}

export function PromotionUpsell({
  isOpen,
  onClose,
  onPromote,
  onBuyCredits,
  userCredits,
  selectedPromotion,
  onSelectPromotion,
}: PromotionUpsellProps) {
  const { formData } = useEventFormContext();
  const { t } = useTranslation();
  const selectedPkg = PROMOTION_PACKAGES.find(
    (p) => p.id === selectedPromotion
  );
  const canAfford = selectedPkg ? userCredits >= selectedPkg.credits : false;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md" showCloseButton={true}>
        <DialogHeader>
          <DialogTitle>{t("promotion.boostYourEvent")}</DialogTitle>
          <DialogDescription>
            {t("promotion.getMoreVisibility", { title: formData.title })}
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          {/* Credits balance */}
          <div className="flex items-center justify-between bg-warning/20 px-4 py-2 rounded-lg">
            <div className="flex items-center gap-2">
              <Coins className="w-5 h-5 text-warning" />
              <span className="font-semibold text-warning">
                {userCredits} credits
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

          <div className="space-y-3">
            {PROMOTION_PACKAGES.map((pkg) => {
              const isSelected = selectedPromotion === pkg.id;
              const affordable = userCredits >= pkg.credits;

              return (
                <PackageCard
                  key={pkg.id}
                  isSelected={isSelected}
                  affordable={affordable}
                  onClick={() => onSelectPromotion(pkg.id)}
                  badge={
                    pkg.id === "combo" ? (
                      <PackageBadge>{t("promotion.bestValue")}</PackageBadge>
                    ) : undefined
                  }
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <RadioButton isSelected={isSelected} />
                      <div>
                        <p className="font-semibold text-foreground">
                          {pkg.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {pkg.description}
                        </p>
                      </div>
                    </div>
                    <CreditsDisplay
                      credits={pkg.credits}
                      originalCredits={pkg.originalCredits}
                      duration={pkg.duration}
                      icon={<Coins className="w-4 h-4 text-warning" />}
                    />
                  </div>
                  {!affordable && (
                    <p className="text-xs text-error">{t("promotion.notEnoughCredits")}</p>
                  )}
                </PackageCard>
              );
            })}
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" className="flex-1">
                {t("promotion.maybeLater")}
              </Button>
            </DialogClose>
            <Button
              onClick={onPromote}
              disabled={!selectedPromotion || !canAfford}
              className="flex-1 bg-primary hover:bg-primary/90"
            >
              {selectedPkg ? (
                <span className="flex items-center gap-1.5">
                  <Coins className="w-4 h-4" />
                  {t("promotion.spendCredits", { credits: selectedPkg.credits })}
                </span>
              ) : (
                t("forms.selectPackage")
              )}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
