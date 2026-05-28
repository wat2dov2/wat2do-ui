import { useState } from "react";

interface PurchaseState {
  selectedPackage: number | null;
  isPurchasing: boolean;
  purchaseComplete: boolean;
  purchasedCredits: number;
}

const initialState: PurchaseState = {
  selectedPackage: null,
  isPurchasing: false,
  purchaseComplete: false,
  purchasedCredits: 0,
};

export function useBuyCreditsForm() {
  const [state, setState] = useState<PurchaseState>(initialState);

  return {
    ...state,
    setSelectedPackage: (pkg: number | null) =>
      setState((prev) => ({ ...prev, selectedPackage: pkg })),
    setPurchasing: (purchasing: boolean) =>
      setState((prev) => ({ ...prev, isPurchasing: purchasing })),
    setPurchaseComplete: (complete: boolean) =>
      setState((prev) => ({ ...prev, purchaseComplete: complete })),
    setPurchasedCredits: (credits: number) =>
      setState((prev) => ({ ...prev, purchasedCredits: credits })),
    reset: () => setState(initialState),
  };
}
