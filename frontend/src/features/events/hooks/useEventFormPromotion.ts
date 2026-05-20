import { useState, useCallback } from "react";
import { useConfetti } from "@/shared/hooks/useConfetti";

interface UseEventFormPromotionOptions {
  createdEventId: number | null;
  userCredits: number;
  onPromote?: (
    eventId: number,
    packageId: string,
  ) => Promise<boolean>;
}

/**
 * Hook for managing promotion flow in the event form
 */
export function useEventFormPromotion({
  createdEventId,
  onPromote,
}: UseEventFormPromotionOptions) {
  const { trigger } = useConfetti();
  const [selectedPromotion, setSelectedPromotion] = useState<string | null>(null);
  const [promotionSuccess, setPromotionSuccess] = useState(false);
  const [showPromotion, setShowPromotion] = useState(false);

  const handlePromote = useCallback(async () => {
    if (!selectedPromotion || !createdEventId || !onPromote) return;

    try {
      const success = await onPromote(createdEventId, selectedPromotion);

      if (success) {
        setPromotionSuccess(true);
        trigger({
          particleCount: 100,
          spread: 70,
          origin: { y: 0.6 },
        });
      }
    } catch (err) {
      console.error("Failed to promote event:", err);
    }
  }, [selectedPromotion, createdEventId, onPromote, trigger]);

  return {
    selectedPromotion,
    setSelectedPromotion,
    promotionSuccess,
    setPromotionSuccess,
    showPromotion,
    setShowPromotion,
    handlePromote,
  };
}
