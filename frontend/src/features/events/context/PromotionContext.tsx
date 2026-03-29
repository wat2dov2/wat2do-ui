import React, { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { EventFormData } from "@/shared/types";

interface PromotionContextValue {
  formData: EventFormData;
  userCredits: number;
  selectedPromotion: string | null;
  onSelectPromotion: (packageId: string) => void;
  onPromote: () => void;
  onBuyCredits: () => void;
}

const PromotionContext = createContext<PromotionContextValue | null>(null);

export function PromotionProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: PromotionContextValue;
}) {
  return (
    <PromotionContext.Provider value={value}>
      {children}
    </PromotionContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function usePromotionContext() {
  const context = useContext(PromotionContext);
  if (!context) {
    throw new Error("usePromotionContext must be used within PromotionProvider");
  }
  return context;
}
