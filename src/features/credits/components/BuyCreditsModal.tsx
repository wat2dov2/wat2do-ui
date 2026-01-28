import React from "react";
import { Coins, Check, CreditCard } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useConfetti } from "@/shared/hooks/useConfetti";
import { useBuyCreditsForm } from "@/features/credits/hooks/useBuyCreditsForm";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { CreditPackageCard } from "@/shared/ui/credit-package-card";
import { ModalContentWrapper, CenteredIconContainer, FlexCol, FlexRow } from "@/shared/ui/modal-components";
import { useModalState } from "@/shared/hooks/useModalState";
import { CREDIT_PACKAGES } from "@/shared/types";

interface BuyCreditsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentCredits: number;
  onPurchase: (credits: number) => void;
}

export function BuyCreditsModal({
  isOpen,
  onClose,
  currentCredits,
  onPurchase,
}: BuyCreditsModalProps) {
  const { t } = useTranslation();
  const { trigger } = useConfetti();
  const form = useBuyCreditsForm();

  // Use modal state hook for standardized open/close handling
  const modalState = useModalState({
    onClose,
    resetOnClose: true,
    resetFn: form.reset,
  });

  const handlePurchase = async () => {
    if (form.selectedPackage === null) return;

    form.setPurchasing(true);

    // Simulate payment processing
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const pkg = CREDIT_PACKAGES[form.selectedPackage];
    const totalCredits = pkg.credits + (pkg.bonus || 0);

    onPurchase(totalCredits);
    form.setPurchasedCredits(totalCredits);
    form.setPurchaseComplete(true);
    form.setPurchasing(false);

    // Fire confetti
    trigger({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 },
      colors: ["#F59E0B", "#FBBF24", "#FCD34D", "#10B981"],
    });
  };

  if (form.purchaseComplete) {
    return (
      <Dialog open={isOpen} onOpenChange={modalState.handleOpenChange}>
        <DialogContent className="max-w-md" showCloseButton={false}>
          <DialogHeader className="text-center">
            <CenteredIconContainer icon={Check} />
            <DialogTitle>{t("credits.added")}</DialogTitle>
            <DialogDescription>
              {t("credits.addedMessage", { count: form.purchasedCredits })}
            </DialogDescription>
          </DialogHeader>
          <ModalContentWrapper>
            <FlexCol className="items-center text-center py-6">
              <div className="flex items-center gap-2 bg-amber-100 px-4 py-2 rounded-full mb-6">
                <Coins className="w-5 h-5 text-warning" />
                <span className="font-bold text-amber-700">
                  {currentCredits + form.purchasedCredits} credits
                </span>
              </div>
              <Button onClick={modalState.handleClose} className="w-full">
                {t("common.done")}
              </Button>
            </FlexCol>
          </ModalContentWrapper>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={modalState.handleOpenChange}>
      <DialogContent className="max-w-md" showCloseButton={true}>
        <DialogHeader>
          <FlexRow className="mb-2" gap="gap-3">
            <CenteredIconContainer icon={Coins} size="sm" />
            <div>
              <DialogTitle>{t("credits.buyCredits")}</DialogTitle>
              <DialogDescription>
                {t("credits.currentBalance")}{" "}
                <span className="font-semibold text-amber-600">
                  {currentCredits} {t("credits.credits")}
                </span>
              </DialogDescription>
            </div>
          </FlexRow>
        </DialogHeader>

        <ModalContentWrapper>
          <div className="space-y-3 mb-6">
            {CREDIT_PACKAGES.map((pkg, index) => (
              <CreditPackageCard
                key={index}
                package={pkg}
                isSelected={form.selectedPackage === index}
                onClick={() => form.setSelectedPackage(index)}
                popularLabel={t("promotion.bestValue")}
              />
            ))}
          </div>

          <Button
            onClick={handlePurchase}
            disabled={form.selectedPackage === null || form.isPurchasing}
            className="w-full bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700"
            size="lg"
          >
            {form.isPurchasing ? (
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                {t("credits.processing")}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <CreditCard className="w-4 h-4" />
                {form.selectedPackage !== null
                  ? `Pay $${CREDIT_PACKAGES[form.selectedPackage].price}`
                  : t("forms.selectPackage")}
              </div>
            )}
          </Button>

          <p className="text-[10px] text-gray-400 text-center mt-3">
            {t("credits.securePayment")}
          </p>
        </ModalContentWrapper>
      </DialogContent>
    </Dialog>
  );
}

export default BuyCreditsModal;
