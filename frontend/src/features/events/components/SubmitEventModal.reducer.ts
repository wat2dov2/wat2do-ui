export type ViewMode = "visual" | "json";

export interface SubmitEventModalState {
  viewMode: ViewMode;
  createdEventId: number | null;
  isSubmitted: boolean;
}

export type SubmitEventModalAction =
  | { type: "SET_VIEW_MODE"; payload: ViewMode }
  | { type: "SET_CREATED_EVENT_ID"; payload: number | null }
  | { type: "SET_IS_SUBMITTED"; payload: boolean }
  | { type: "RESET" };

export const initialSubmitEventModalState: SubmitEventModalState = {
  viewMode: "visual",
  createdEventId: null,
  isSubmitted: false,
};

export function submitEventModalReducer(
  state: SubmitEventModalState,
  action: SubmitEventModalAction
): SubmitEventModalState {
  switch (action.type) {
    case "SET_VIEW_MODE":
      return { ...state, viewMode: action.payload };
    case "SET_CREATED_EVENT_ID":
      return { ...state, createdEventId: action.payload };
    case "SET_IS_SUBMITTED":
      return { ...state, isSubmitted: action.payload };
    case "RESET":
      return initialSubmitEventModalState;
    default:
      return state;
  }
}
