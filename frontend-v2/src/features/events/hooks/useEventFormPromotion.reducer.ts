export interface PromotionState {
  selectedPromotion: string | null;
  promotionSuccess: boolean;
  showPromotion: boolean;
}

export type PromotionAction =
  | { type: "SET_SELECTED_PROMOTION"; payload: string | null }
  | { type: "SET_PROMOTION_SUCCESS"; payload: boolean }
  | { type: "SET_SHOW_PROMOTION"; payload: boolean }
  | { type: "RESET" };

export const initialPromotionState: PromotionState = {
  selectedPromotion: null,
  promotionSuccess: false,
  showPromotion: false,
};

export function promotionReducer(
  state: PromotionState,
  action: PromotionAction
): PromotionState {
  switch (action.type) {
    case "SET_SELECTED_PROMOTION":
      return { ...state, selectedPromotion: action.payload };
    case "SET_PROMOTION_SUCCESS":
      return { ...state, promotionSuccess: action.payload };
    case "SET_SHOW_PROMOTION":
      return { ...state, showPromotion: action.payload };
    case "RESET":
      return initialPromotionState;
    default:
      return state;
  }
}
