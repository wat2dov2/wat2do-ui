import { useState, useCallback } from "react";
import { useConfetti } from "@/hooks/useConfetti";
import { PROMOTION_PACKAGES } from "@/types";

interface UseEventFormPromotionOptions {
  createdEventId: number | null;
  userCredits: number;
  onPromote?: (
    eventId: number,
    packageId: string,
    credits: number,
    duration: number
  ) => boolean;
}

/**
 * Hook for managing promotion flow in the event form
 */
export function useEventFormPromotion({
  createdEventId,
  userCredits,
  onPromote,
}: UseEventFormPromotionOptions) {
  const { trigger } = useConfetti();
  const [selectedPromotion, setSelectedPromotion] = useState<string | null>(null);
  const [promotionSuccess, setPromotionSuccess] = useState(false);
  const [showPromotion, setShowPromotion] = useState(false);

  const handlePromote = useCallback(() => {
    if (!selectedPromotion || !createdEventId || !onPromote) return;

    const pkg = PROMOTION_PACKAGES.find((p) => p.id === selectedPromotion);
    if (!pkg) return;

    const success = onPromote(
      createdEventId,
      pkg.id,
      pkg.credits,
      pkg.duration
    );
    
    if (success) {
      setPromotionSuccess(true);
      trigger({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
        colors: ["#A855F7", "#EC4899", "#8B5CF6", "#F59E0B"],
      });
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
