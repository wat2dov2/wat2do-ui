import type { EventFormData, ValidationErrors } from "@/shared/types";

export interface EventFormSubmissionState {
  formData: EventFormData;
  selectedDate: Date | undefined;
  foodInput: string;
  errors: ValidationErrors;
  touched: Record<string, boolean>;
  isSubmitted: boolean;
  createdEventId: number | null;
  successMessage: string;
}

export type EventFormSubmissionAction =
  | { type: "SET_FORM_DATA"; payload: EventFormData }
  | { type: "SET_SELECTED_DATE"; payload: Date | undefined }
  | { type: "SET_FOOD_INPUT"; payload: string }
  | { type: "SET_ERRORS"; payload: ValidationErrors }
  | { type: "SET_TOUCHED"; payload: Record<string, boolean> }
  | { type: "SET_IS_SUBMITTED"; payload: boolean }
  | { type: "SET_CREATED_EVENT_ID"; payload: number | null }
  | { type: "SET_SUCCESS_MESSAGE"; payload: string }
  | { type: "RESET"; payload: { formData: EventFormData; selectedDate: Date | undefined } };

export function eventFormSubmissionReducer(
  state: EventFormSubmissionState,
  action: EventFormSubmissionAction
): EventFormSubmissionState {
  switch (action.type) {
    case "SET_FORM_DATA":
      return { ...state, formData: action.payload };
    case "SET_SELECTED_DATE":
      return { ...state, selectedDate: action.payload };
    case "SET_FOOD_INPUT":
      return { ...state, foodInput: action.payload };
    case "SET_ERRORS":
      return { ...state, errors: action.payload };
    case "SET_TOUCHED":
      return { ...state, touched: action.payload };
    case "SET_IS_SUBMITTED":
      return { ...state, isSubmitted: action.payload };
    case "SET_CREATED_EVENT_ID":
      return { ...state, createdEventId: action.payload };
    case "SET_SUCCESS_MESSAGE":
      return { ...state, successMessage: action.payload };
    case "RESET":
      return {
        ...state,
        formData: action.payload.formData,
        selectedDate: action.payload.selectedDate,
        foodInput: "",
        errors: {},
        touched: {},
        isSubmitted: false,
        createdEventId: null,
        successMessage: "",
      };
    default:
      return state;
  }
}
