import type { EventFormData } from "@/shared/types";

interface ValidationErrors {
  title?: string;
  organization?: string;
  date?: string;
  time?: string;
  location?: string;
}

export interface FormState {
  formData: EventFormData;
  selectedDate: Date | undefined;
  foodInput: string;
  touched: Record<string, boolean>;
  jsonValue: string;
  jsonError: string;
  aiPrompt: string;
  aiGenerating: boolean;
}

export type FormAction =
  | { type: "SET_FORM_DATA"; payload: EventFormData }
  | { type: "UPDATE_FIELD"; payload: { field: keyof EventFormData; value: EventFormData[keyof EventFormData] } }
  | { type: "SET_SELECTED_DATE"; payload: Date | undefined }
  | { type: "SET_FOOD_INPUT"; payload: string }
  | { type: "ADD_FOOD"; payload: string }
  | { type: "REMOVE_FOOD"; payload: number }
  | { type: "SET_TOUCHED"; payload: Record<string, boolean> }
  | { type: "TOUCH_FIELD"; payload: string }
  | { type: "SET_JSON_VALUE"; payload: string }
  | { type: "SET_JSON_ERROR"; payload: string }
  | { type: "SET_AI_PROMPT"; payload: string }
  | { type: "SET_AI_GENERATING"; payload: boolean }
  | { type: "RESET"; payload: { formData: EventFormData; selectedDate: Date | undefined } };

export function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case "SET_FORM_DATA":
      return { ...state, formData: action.payload };
    case "UPDATE_FIELD":
      return {
        ...state,
        formData: { ...state.formData, [action.payload.field]: action.payload.value },
      };
    case "SET_SELECTED_DATE": {
      const dateStr = action.payload ? action.payload.toISOString().split("T")[0] : "";
      return {
        ...state,
        selectedDate: action.payload,
        formData: { ...state.formData, date: dateStr },
      };
    }
    case "SET_FOOD_INPUT":
      return { ...state, foodInput: action.payload };
    case "ADD_FOOD":
      return {
        ...state,
        formData: {
          ...state.formData,
          food: [...state.formData.food, action.payload],
        },
        foodInput: "",
      };
    case "REMOVE_FOOD":
      return {
        ...state,
        formData: {
          ...state.formData,
          food: state.formData.food.filter((_, i) => i !== action.payload),
        },
      };
    case "SET_TOUCHED":
      return { ...state, touched: action.payload };
    case "TOUCH_FIELD":
      return {
        ...state,
        touched: { ...state.touched, [action.payload]: true },
      };
    case "SET_JSON_VALUE":
      return { ...state, jsonValue: action.payload };
    case "SET_JSON_ERROR":
      return { ...state, jsonError: action.payload };
    case "SET_AI_PROMPT":
      return { ...state, aiPrompt: action.payload };
    case "SET_AI_GENERATING":
      return { ...state, aiGenerating: action.payload };
    case "RESET":
      return {
        formData: action.payload.formData,
        selectedDate: action.payload.selectedDate,
        foodInput: "",
        touched: {},
        jsonValue: "",
        jsonError: "",
        aiPrompt: "",
        aiGenerating: false,
      };
    default:
      return state;
  }
}
