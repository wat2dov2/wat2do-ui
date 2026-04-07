import { useReducer, useMemo, useCallback } from "react";
import type { EventFormData, ValidationErrors } from "@/shared/types";
import {
  validateEventForm,
  isEventFormValid,
  markAllFieldsTouched,
} from "@/shared/services/validationService";

interface FormState {
  formData: EventFormData;
  selectedDate: Date | undefined;
  foodInput: string;
  errors: ValidationErrors;
  touched: Record<string, boolean>;
  jsonValue: string;
  jsonError: string;
  aiPrompt: string;
  aiGenerating: boolean;
}

type FormAction =
  | { type: "SET_FORM_DATA"; payload: EventFormData }
  | { type: "UPDATE_FIELD"; payload: { field: keyof EventFormData; value: EventFormData[keyof EventFormData] } }
  | { type: "SET_SELECTED_DATE"; payload: Date | undefined }
  | { type: "SET_FOOD_INPUT"; payload: string }
  | { type: "ADD_FOOD"; payload: string }
  | { type: "REMOVE_FOOD"; payload: number }
  | { type: "SET_ERRORS"; payload: ValidationErrors }
  | { type: "SET_TOUCHED"; payload: Record<string, boolean> }
  | { type: "TOUCH_FIELD"; payload: string }
  | { type: "SET_JSON_VALUE"; payload: string }
  | { type: "SET_JSON_ERROR"; payload: string }
  | { type: "SET_AI_PROMPT"; payload: string }
  | { type: "SET_AI_GENERATING"; payload: boolean }
  | { type: "RESET"; payload: { formData: EventFormData; selectedDate: Date | undefined } };

function getSmartDefaults() {
  const now = new Date();
  const today = now.toISOString().split("T")[0];
  const nextHour = new Date(now.setHours(now.getHours() + 1, 0, 0, 0));
  const time = `${nextHour.getHours().toString().padStart(2, "0")}:00`;
  return { date: today, time };
}

function getInitialState(initialData?: EventFormData, isEditMode = false): FormState {
  const smartDefaults = getSmartDefaults();
  const formData = isEditMode && initialData
    ? initialData
    : {
        title: "",
        description: "",
        date: smartDefaults.date,
        time: smartDefaults.time,
        location: "",
        category: "",
        price: 0,
        food: [],
        requiresRegistration: false,
        organization: "",
      };

  const dateStr = formData.date || smartDefaults.date;
  const selectedDate = dateStr
    ? (() => {
        const date = new Date(dateStr);
        return isNaN(date.getTime()) ? undefined : date;
      })()
    : undefined;

  return {
    formData,
    selectedDate,
    foodInput: "",
    errors: {},
    touched: {},
    jsonValue: "",
    jsonError: "",
    aiPrompt: "",
    aiGenerating: false,
  };
}

function formReducer(state: FormState, action: FormAction): FormState {
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
    case "SET_ERRORS":
      return { ...state, errors: action.payload };
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
      return getInitialState(action.payload.formData, !!action.payload.formData.title);
    default:
      return state;
  }
}

interface UseEventFormReducerOptions {
  initialData?: EventFormData;
  isEditMode?: boolean;
  isOpen: boolean;
}

export function useEventFormReducer(options: UseEventFormReducerOptions) {
  const { initialData, isEditMode = false, isOpen } = options;

  const initialState = useMemo(
    () => getInitialState(initialData, isEditMode),
    [initialData, isEditMode]
  );

  const [state, dispatch] = useReducer(formReducer, initialState);

  // Reset form when modal opens
  useMemo(() => {
    if (isOpen) {
      const smartDefaults = getSmartDefaults();
      const formData = isEditMode && initialData
        ? initialData
        : {
            title: "",
            description: "",
            date: smartDefaults.date,
            time: smartDefaults.time,
            location: "",
            category: "",
            price: 0,
            food: [],
            requiresRegistration: false,
            organization: "",
          };

      const dateStr = formData.date || smartDefaults.date;
      const selectedDate = dateStr
        ? (() => {
            const date = new Date(dateStr);
            return isNaN(date.getTime()) ? undefined : date;
          })()
        : undefined;

      dispatch({
        type: "RESET",
        payload: { formData, selectedDate },
      });
    }
  }, [isOpen, isEditMode, initialData]);

  // Validate on change - use useMemo instead of useEffect
  const errors = useMemo(
    () => validateEventForm(state.formData, state.touched),
    [state.formData, state.touched]
  );

  // Update errors in state
  useMemo(() => {
    if (JSON.stringify(errors) !== JSON.stringify(state.errors)) {
      dispatch({ type: "SET_ERRORS", payload: errors });
    }
  }, [errors, state.errors]);

  const handleBlur = useCallback((field: string) => {
    dispatch({ type: "TOUCH_FIELD", payload: field });
  }, []);

  const updateField = useCallback(
    <K extends keyof EventFormData>(field: K, value: EventFormData[K]) => {
      dispatch({ type: "UPDATE_FIELD", payload: { field, value } });
    },
    []
  );

  const handleDateChange = useCallback((date: Date | undefined) => {
    dispatch({ type: "SET_SELECTED_DATE", payload: date });
  }, []);

  const addFood = useCallback(() => {
    if (state.foodInput.trim()) {
      dispatch({ type: "ADD_FOOD", payload: state.foodInput.trim() });
    }
  }, [state.foodInput]);

  const removeFood = useCallback((index: number) => {
    dispatch({ type: "REMOVE_FOOD", payload: index });
  }, []);

  const handleJsonChange = useCallback(
    (value: string | undefined) => {
      if (!value) return;
      dispatch({ type: "SET_JSON_VALUE", payload: value });

      try {
        const parsed = JSON.parse(value);
        dispatch({ type: "SET_JSON_ERROR", payload: "" });

        const smartDefaults = getSmartDefaults();
        dispatch({
          type: "SET_FORM_DATA",
          payload: {
            title: parsed.title || "",
            description: parsed.description || "",
            date: parsed.date || smartDefaults.date,
            time: parsed.time || smartDefaults.time,
            location: parsed.location || "",
            category: parsed.category || "",
            price: typeof parsed.price === "number" ? parsed.price : 0,
            food: Array.isArray(parsed.food) ? parsed.food : [],
            requiresRegistration:
              typeof parsed.requiresRegistration === "boolean"
                ? parsed.requiresRegistration
                : false,
            organization: parsed.organization || "",
          },
        });
      } catch (err) {
        console.error("Failed to parse event form JSON:", err);
        dispatch({ type: "SET_JSON_ERROR", payload: "Invalid JSON format" });
      }
    },
    []
  );

  const syncToJSON = useCallback(() => {
    dispatch({
      type: "SET_JSON_VALUE",
      payload: JSON.stringify(state.formData, null, 2),
    });
  }, [state.formData]);

  const isValid = isEventFormValid(state.formData, errors);

  return {
    // Form data
    formData: state.formData,
    setFormData: (data: EventFormData) => dispatch({ type: "SET_FORM_DATA", payload: data }),
    updateField,

    // Date picker
    selectedDate: state.selectedDate,
    handleDateChange,

    // Food management
    foodInput: state.foodInput,
    setFoodInput: (value: string) => dispatch({ type: "SET_FOOD_INPUT", payload: value }),
    addFood,
    removeFood,

    // Validation
    errors,
    touched: state.touched,
    handleBlur,
    isValid,

    // JSON editor
    jsonValue: state.jsonValue,
    setJsonValue: (value: string) => dispatch({ type: "SET_JSON_VALUE", payload: value }),
    jsonError: state.jsonError,
    setJsonError: (error: string) => dispatch({ type: "SET_JSON_ERROR", payload: error }),
    handleJsonChange,
    syncToJSON,

    // AI generation
    aiPrompt: state.aiPrompt,
    setAiPrompt: (prompt: string) => dispatch({ type: "SET_AI_PROMPT", payload: prompt }),
    aiGenerating: state.aiGenerating,
    setAiGenerating: (generating: boolean) =>
      dispatch({ type: "SET_AI_GENERATING", payload: generating }),

    // Utilities
    markAllFieldsTouched: () => {
      const allTouched = markAllFieldsTouched();
      dispatch({ type: "SET_TOUCHED", payload: allTouched });
    },
  };
}
