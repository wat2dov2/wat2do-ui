import type { FilterState } from "@/shared/types";

export interface FormState {
  name: string;
  description: string;
  destinationType: "event" | "events-list" | "custom-url";
  selectedEventId: number | undefined;
  customUrl: string;
  filters: FilterState | undefined;
  qrCodeId: string | null;
  errors: Record<string, string>;
  imageUrl: string;
  imagePreview: string;
}

export type FormAction =
  | { type: "SET_NAME"; payload: string }
  | { type: "SET_DESCRIPTION"; payload: string }
  | { type: "SET_DESTINATION_TYPE"; payload: "event" | "events-list" | "custom-url" }
  | { type: "SET_SELECTED_EVENT_ID"; payload: number | undefined }
  | { type: "SET_CUSTOM_URL"; payload: string }
  | { type: "SET_FILTERS"; payload: FilterState | undefined }
  | { type: "SET_QR_CODE_ID"; payload: string | null }
  | { type: "SET_ERRORS"; payload: Record<string, string> }
  | { type: "SET_IMAGE_URL"; payload: string }
  | { type: "SET_IMAGE_PREVIEW"; payload: string }
  | { type: "RESET" };

export const initialState: FormState = {
  name: "",
  description: "",
  destinationType: "event",
  selectedEventId: undefined,
  customUrl: "",
  filters: undefined,
  qrCodeId: null,
  errors: {},
  imageUrl: "",
  imagePreview: "",
};

export function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case "SET_NAME":
      return { ...state, name: action.payload };
    case "SET_DESCRIPTION":
      return { ...state, description: action.payload };
    case "SET_DESTINATION_TYPE":
      return { ...state, destinationType: action.payload };
    case "SET_SELECTED_EVENT_ID":
      return { ...state, selectedEventId: action.payload };
    case "SET_CUSTOM_URL":
      return { ...state, customUrl: action.payload };
    case "SET_FILTERS":
      return { ...state, filters: action.payload };
    case "SET_QR_CODE_ID":
      return { ...state, qrCodeId: action.payload };
    case "SET_ERRORS":
      return { ...state, errors: action.payload };
    case "SET_IMAGE_URL":
      return { ...state, imageUrl: action.payload };
    case "SET_IMAGE_PREVIEW":
      return { ...state, imagePreview: action.payload };
    case "RESET":
      return initialState;
    default:
      return state;
  }
}
