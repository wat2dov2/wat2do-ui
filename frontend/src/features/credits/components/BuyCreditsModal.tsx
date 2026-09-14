import { useState } from "react";
import { Coins, Check, CreditCard, AlertCircle } from "@/shared/ui/doodle-icons";
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
import { LoadingButton } from "@/shared/ui/loading-button";
import { CreditPackageCard } from "@/shared/ui/credit-package-card";
import { ModalContentWrapper, CenteredIconContainer, FlexCol, FlexRow } from "@/shared/ui/modal-components";
import { useModalState } from "@/shared/hooks/useModalState";
import { CREDIT_PACKAGES } from "@/shared/constants/promotions";

interface BuyCreditsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentCredits: number;
  // Await so success UI only runs after the backend resolves.
  onPurchase: (credits: number) => Promise<void> | void;
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
  const [purchaseError, setPurchaseError] = useState<string | null>(null);

  const modalState = useModalState({
    onClose,
    resetFn: () => {
      form.reset();
      setPurchaseError(null);
    },
  });

  const handlePurchase = async () => {
    if (form.selectedPackage === null) return;

    setPurchaseError(null);
    form.setPurchasing(true);

    const pkg = CREDIT_PACKAGES[form.selectedPackage];
    const totalCredits = pkg.credits + (pkg.bonus || 0);

    try {
      await onPurchase(totalCredits);
      form.setPurchasedCredits(totalCredits);
      form.setPurchaseComplete(true);
      trigger({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
      });
    } catch (err) {
      console.error("Credit purchase failed:", err);
      const message =
        err instanceof Error && err.message
          ? err.message
          : t("credits.purchaseFailed");
      setPurchaseError(message);
    } finally {
      form.setPurchasing(false);
    }
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
                <Coins className="size-5 text-warning" />
                <span className="font-bold text-amber-700">
                  {t("credits.creditCount", { count: currentCredits + form.purchasedCredits })}
                </span>
              </div>
              <Button onMouseDown={modalState.handleClose} className="w-full">
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
                  {t("credits.creditCount", { count: currentCredits })}
                </span>
              </DialogDescription>
            </div>
          </FlexRow>
        </DialogHeader>

        <ModalContentWrapper>
          <div className="space-y-3 mb-6">
            {CREDIT_PACKAGES.map((pkg, index) => (
              <CreditPackageCard
                key={pkg.credits}
                package={pkg}
                isSelected={form.selectedPackage === index}
                onMouseDown={() => form.setSelectedPackage(index)}
                popularLabel={t("promotion.bestValue")}
              />
            ))}
          </div>

          {purchaseError && (
            <div
              role="alert"
              className="flex items-start gap-2 p-3 mb-3 rounded-md bg-red-50 border border-red-200 text-red-700 text-sm"
            >
              <AlertCircle className="size-4 mt-0.5 flex-shrink-0" />
              <span>{purchaseError}</span>
            </div>
          )}

          <LoadingButton
            onMouseDown={handlePurchase}
            disabled={form.selectedPackage === null}
            isLoading={form.isPurchasing}
            loadingText={t("credits.processing")}
            className="w-full bg-linear-to-r from-warning to-amber-600 hover:from-amber-600 hover:to-amber-700"
            size="lg"
          >
            <span className="flex items-center gap-2">
              <CreditCard className="size-4" />
              {form.selectedPackage !== null
                ? `Pay $${CREDIT_PACKAGES[form.selectedPackage].price}`
                : t("forms.selectPackage")}
            </span>
          </LoadingButton>

          <p className="text-[10px] text-muted-foreground text-center mt-3">
            {t("credits.securePayment")}
          </p>
        </ModalContentWrapper>
      </DialogContent>
    </Dialog>
  );
}
