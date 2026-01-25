import { useState, useCallback } from "react";
import { usePromotions } from "./usePromotions";

/**
 * Hook for managing promotions in the App component
 * Extends usePromotions with App-specific functionality like buy credits modal
 */
export function useAppPromotions() {
  const promotions = usePromotions();
  const [showBuyCredits, setShowBuyCredits] = useState(false);

  // Promote event handler that shows buy credits modal if needed
  const promoteEvent = useCallback(
    (eventId: number, packageId: string, credits: number, duration: number): boolean => {
      const result = promotions.promoteEvent(eventId, packageId, credits, duration);
      
      if (result.needsCredits) {
        setShowBuyCredits(true);
        return false;
      }
      
      return result.success;
    },
    [promotions]
  );

  return {
    ...promotions,
    showBuyCredits,
    setShowBuyCredits,
    promoteEvent,
  };
}
