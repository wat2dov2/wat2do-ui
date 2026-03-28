import { useReducer, useCallback } from "react";
import { useConfetti } from "@/shared/hooks/useConfetti";
import { PROMOTION_PACKAGES } from "@/shared/types";
import {
  promotionReducer,
  initialPromotionState,
} from "@/features/events/hooks/useEventFormPromotion.reducer";

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
  const [state, dispatch] = useReducer(promotionReducer, initialPromotionState);

  const handlePromote = useCallback(() => {
    if (!state.selectedPromotion || !createdEventId || !onPromote) return;

    const pkg = PROMOTION_PACKAGES.find((p) => p.id === state.selectedPromotion);
    if (!pkg) return;

    const success = onPromote(
      createdEventId,
      pkg.id,
      pkg.credits,
      pkg.duration
    );
    
    if (success) {
      dispatch({ type: "SET_PROMOTION_SUCCESS", payload: true });
      trigger({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
      });
    }
  }, [state.selectedPromotion, createdEventId, onPromote, trigger]);

  return {
    selectedPromotion: state.selectedPromotion,
    setSelectedPromotion: (value: string | null) =>
      dispatch({ type: "SET_SELECTED_PROMOTION", payload: value }),
    promotionSuccess: state.promotionSuccess,
    setPromotionSuccess: (value: boolean) =>
      dispatch({ type: "SET_PROMOTION_SUCCESS", payload: value }),
    showPromotion: state.showPromotion,
    setShowPromotion: (value: boolean) =>
      dispatch({ type: "SET_SHOW_PROMOTION", payload: value }),
    handlePromote,
  };
}
