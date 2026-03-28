import { useReducer } from "react";

interface PurchaseState {
  selectedPackage: number | null;
  isPurchasing: boolean;
  purchaseComplete: boolean;
  purchasedCredits: number;
}

type PurchaseAction =
  | { type: "SET_SELECTED_PACKAGE"; payload: number | null }
  | { type: "SET_PURCHASING"; payload: boolean }
  | { type: "SET_PURCHASE_COMPLETE"; payload: boolean }
  | { type: "SET_PURCHASED_CREDITS"; payload: number }
  | { type: "RESET" };

const initialState: PurchaseState = {
  selectedPackage: null,
  isPurchasing: false,
  purchaseComplete: false,
  purchasedCredits: 0,
};

function purchaseReducer(state: PurchaseState, action: PurchaseAction): PurchaseState {
  switch (action.type) {
    case "SET_SELECTED_PACKAGE":
      return { ...state, selectedPackage: action.payload };
    case "SET_PURCHASING":
      return { ...state, isPurchasing: action.payload };
    case "SET_PURCHASE_COMPLETE":
      return { ...state, purchaseComplete: action.payload };
    case "SET_PURCHASED_CREDITS":
      return { ...state, purchasedCredits: action.payload };
    case "RESET":
      return initialState;
    default:
      return state;
  }
}

export function useBuyCreditsForm() {
  const [state, dispatch] = useReducer(purchaseReducer, initialState);

  return {
    ...state,
    setSelectedPackage: (pkg: number | null) =>
      dispatch({ type: "SET_SELECTED_PACKAGE", payload: pkg }),
    setPurchasing: (purchasing: boolean) =>
      dispatch({ type: "SET_PURCHASING", payload: purchasing }),
    setPurchaseComplete: (complete: boolean) =>
      dispatch({ type: "SET_PURCHASE_COMPLETE", payload: complete }),
    setPurchasedCredits: (credits: number) =>
      dispatch({ type: "SET_PURCHASED_CREDITS", payload: credits }),
    reset: () => dispatch({ type: "RESET" }),
  };
}
