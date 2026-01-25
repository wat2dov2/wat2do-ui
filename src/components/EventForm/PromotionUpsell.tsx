import React from "react";
import { Check, Coins } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import { PROMOTION_PACKAGES } from "@/types";
import type { EventFormData } from "@/types";

interface PromotionUpsellProps {
  isOpen: boolean;
  onClose: () => void;
  onPromote: () => void;
  onBuyCredits: () => void;
  formData: EventFormData;
  userCredits: number;
  selectedPromotion: string | null;
  onSelectPromotion: (packageId: string) => void;
}

export function PromotionUpsell({
  isOpen,
  onClose,
  onPromote,
  onBuyCredits,
  formData,
  userCredits,
  selectedPromotion,
  onSelectPromotion,
}: PromotionUpsellProps) {
  const selectedPkg = PROMOTION_PACKAGES.find(
    (p) => p.id === selectedPromotion
  );
  const canAfford = selectedPkg ? userCredits >= selectedPkg.credits : false;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md" showCloseButton={true}>
        <DialogHeader>
          <DialogTitle>Boost Your Event</DialogTitle>
          <DialogDescription>
            Get more visibility for "{formData.title}"
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
              variant="ghost"
              size="sm"
              onClick={onBuyCredits}
              className="text-xs font-medium text-warning hover:text-warning/80 h-auto p-0"
            >
              + Buy more
            </Button>
          </div>

          <div className="space-y-3">
            {PROMOTION_PACKAGES.map((pkg) => {
              const isSelected = selectedPromotion === pkg.id;
              const affordable = userCredits >= pkg.credits;

              return (
                <button
                  key={pkg.id}
                  onClick={() => onSelectPromotion(pkg.id)}
                  className={`w-full p-4 rounded-lg border-2 text-left transition-all relative ${
                    isSelected
                      ? "border-primary bg-primary/10"
                      : affordable
                      ? "border-border hover:border-primary/50"
                      : "border-border opacity-60"
                  }`}
                  disabled={!affordable}
                >
                  {pkg.id === "combo" && (
                    <div className="absolute -top-2 left-4 bg-primary text-primary-foreground text-[10px] font-bold px-2 py-0.5 rounded">
                      BEST VALUE
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                          isSelected
                            ? "border-primary bg-primary"
                            : "border-border"
                        }`}
                      >
                        {isSelected && (
                          <Check
                            className="w-3 h-3 text-white"
                            strokeWidth={3}
                          />
                        )}
                      </div>
                      <div>
                        <p className="font-semibold text-foreground">
                          {pkg.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {pkg.description}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="flex items-center gap-1">
                        <Coins className="w-4 h-4 text-warning" />
                        <span className="font-bold text-foreground">
                          {pkg.credits}
                        </span>
                      </div>
                      {pkg.originalCredits && (
                        <p className="text-xs text-muted-foreground line-through">
                          {pkg.originalCredits} credits
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {pkg.duration} day{pkg.duration > 1 ? "s" : ""}
                      </p>
                    </div>
                  </div>
                  {!affordable && (
                    <p className="text-xs text-error">Not enough credits</p>
                  )}
                </button>
              );
            })}
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" className="flex-1">
                Maybe Later
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
                  Spend {selectedPkg.credits} credits
                </span>
              ) : (
                "Select a package"
              )}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
