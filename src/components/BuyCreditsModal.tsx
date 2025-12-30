import React, { useState } from "react";
import { Coins, Check, Sparkles, X, CreditCard } from "lucide-react";
import confetti from "canvas-confetti";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CREDIT_PACKAGES } from "@/types";

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
  const [selectedPackage, setSelectedPackage] = useState<number | null>(null);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [purchaseComplete, setPurchaseComplete] = useState(false);
  const [purchasedCredits, setPurchasedCredits] = useState(0);

  const handlePurchase = async () => {
    if (selectedPackage === null) return;

    setIsPurchasing(true);

    // Simulate payment processing
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const pkg = CREDIT_PACKAGES[selectedPackage];
    const totalCredits = pkg.credits + (pkg.bonus || 0);

    onPurchase(totalCredits);
    setPurchasedCredits(totalCredits);
    setPurchaseComplete(true);
    setIsPurchasing(false);

    // Fire confetti
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 },
      colors: ["#F59E0B", "#FBBF24", "#FCD34D", "#10B981"],
    });
  };

  const handleClose = () => {
    setSelectedPackage(null);
    setPurchaseComplete(false);
    setPurchasedCredits(0);
    onClose();
  };

  if (purchaseComplete) {
    return (
      <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
        <DialogContent className="max-w-md" showCloseButton={false}>
          <div className="flex flex-col items-center text-center py-6">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-amber-400 to-amber-500 flex items-center justify-center mb-4">
              <Check className="w-8 h-8 text-white" strokeWidth={3} />
            </div>

            <h2 className="text-xl font-bold text-gray-900 mb-2">
              Credits Added!
            </h2>
            <p className="text-gray-500 text-sm mb-4">
              {purchasedCredits} credits have been added to your account.
            </p>

            <div className="flex items-center gap-2 bg-amber-50 px-4 py-2 rounded-full mb-6">
              <Coins className="w-5 h-5 text-amber-500" />
              <span className="font-bold text-amber-700">
                {currentCredits + purchasedCredits} credits
              </span>
            </div>

            <Button onClick={handleClose} className="w-full">
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-md" showCloseButton={false}>
        <button
          onClick={handleClose}
          className="absolute top-3 right-3 p-2 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <X className="w-5 h-5 text-gray-500" />
        </button>

        <div className="py-2">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-amber-400 to-amber-500 flex items-center justify-center">
              <Coins className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">Buy Credits</h2>
              <p className="text-sm text-gray-500">
                Current balance:{" "}
                <span className="font-semibold text-amber-600">
                  {currentCredits} credits
                </span>
              </p>
            </div>
          </div>

          <div className="space-y-3 mb-6">
            {CREDIT_PACKAGES.map((pkg, index) => (
              <button
                key={index}
                onClick={() => setSelectedPackage(index)}
                className={`w-full p-4 rounded-lg border-2 text-left transition-all relative ${
                  selectedPackage === index
                    ? "border-amber-500 bg-amber-50"
                    : "border-gray-200 hover:border-amber-300"
                }`}
              >
                {pkg.popular && (
                  <div className="absolute -top-2 left-4 bg-amber-500 text-white text-[10px] font-bold px-2 py-0.5 rounded">
                    BEST VALUE
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                        selectedPackage === index
                          ? "border-amber-500 bg-amber-500"
                          : "border-gray-300"
                      }`}
                    >
                      {selectedPackage === index && (
                        <Check className="w-3 h-3 text-white" strokeWidth={3} />
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-900">
                          {pkg.credits} credits
                        </span>
                        {pkg.bonus && (
                          <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-medium">
                            +{pkg.bonus} bonus
                          </span>
                        )}
                      </div>
                      {pkg.bonus && (
                        <p className="text-xs text-gray-500">
                          {pkg.credits + pkg.bonus} total credits
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-gray-900">${pkg.price}</p>
                    <p className="text-xs text-gray-400">
                      ${((pkg.price / (pkg.credits + (pkg.bonus || 0))) * 100).toFixed(1)}¢/credit
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>

          <Button
            onClick={handlePurchase}
            disabled={selectedPackage === null || isPurchasing}
            className="w-full bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700"
            size="lg"
          >
            {isPurchasing ? (
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Processing...
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <CreditCard className="w-4 h-4" />
                {selectedPackage !== null
                  ? `Pay $${CREDIT_PACKAGES[selectedPackage].price}`
                  : "Select a package"}
              </div>
            )}
          </Button>

          <p className="text-[10px] text-gray-400 text-center mt-3">
            Secure payment powered by Stripe. Credits never expire.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default BuyCreditsModal;
