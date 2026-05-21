import { useState, useCallback } from "react";
import { useConfetti } from "@/shared/hooks/useConfetti";

interface UseEventFormPromotionOptions {
  createdEventId: number | null;
  onPromote?: (eventId: number) => Promise<boolean>;
}

/**
 * Hook for managing promotion flow in the event form
 */
export function useEventFormPromotion({
  createdEventId,
  onPromote,
}: UseEventFormPromotionOptions) {
  const { trigger } = useConfetti();
  const [promotionSuccess, setPromotionSuccess] = useState(false);
  const [showPromotion, setShowPromotion] = useState(false);

  const handlePromote = useCallback(async () => {
    if (!createdEventId || !onPromote) return;

    try {
      const success = await onPromote(createdEventId);

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
  }, [createdEventId, onPromote, trigger]);

  return {
    promotionSuccess,
    setPromotionSuccess,
    showPromotion,
    setShowPromotion,
    handlePromote,
  };
}
