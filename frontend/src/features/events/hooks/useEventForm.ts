import { useState, useReducer, useMemo, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { EventFormData } from "@/shared/types";
import {
  validateEventForm,
  isEventFormValid,
  markAllFieldsTouched,
} from "@/shared/services/validationService";
import { generateEventWithAI } from "@/shared/lib/openai";
import { formReducer, type FormState } from "@/features/events/hooks/useEventForm.reducer";
import { getInitialState, getSmartDefaults } from "@/features/events/hooks/useEventForm.utils";

interface UseEventFormOptions {
  initialData?: EventFormData;
  isEditMode?: boolean;
  isOpen: boolean;
}

/**
 * Custom hook for managing event form state and validation
 */
export function useEventForm(options: UseEventFormOptions) {
  const { initialData, isEditMode = false, isOpen } = options;
  const { t } = useTranslation();
  const prevIsOpenRef = useRef(isOpen);

  const initialState = useMemo(
    () => getInitialState(initialData, isEditMode),
    [initialData, isEditMode]
  );

  const [state, dispatch] = useReducer(formReducer, initialState);

  // Reset form when modal opens (derived from isOpen change, no useEffect needed)
  if (isOpen && !prevIsOpenRef.current) {
    const resetState = getInitialState(initialData, isEditMode);
    dispatch({
      type: "RESET",
      payload: { formData: resetState.formData, selectedDate: resetState.selectedDate },
    });
  }
  prevIsOpenRef.current = isOpen;

  // Validate on change - use useMemo instead of useEffect
  const errors = useMemo(
    () => validateEventForm(state.formData, state.touched),
    [state.formData, state.touched]
  );

  const handleBlur = useCallback((field: string) => {
    dispatch({ type: "TOUCH_FIELD", payload: field });
  }, []);

  // Handle JSON changes
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
      } catch {
        dispatch({ type: "SET_JSON_ERROR", payload: t("forms.invalidJsonFormat") });
      }
    },
    [t]
  );

  // Handle AI generation
  const handleAiGenerate = useCallback(async () => {
    if (!state.aiPrompt.trim()) return;

    dispatch({ type: "SET_AI_GENERATING", payload: true });
    dispatch({ type: "SET_JSON_ERROR", payload: "" });

    try {
      const newEvent = await generateEventWithAI(state.aiPrompt, (partialJson) => {
        dispatch({ type: "SET_JSON_VALUE", payload: partialJson });
      });

      const generatedJson = JSON.stringify(newEvent, null, 2);
      dispatch({ type: "SET_JSON_VALUE", payload: generatedJson });
      handleJsonChange(generatedJson);
    } catch (error) {
      dispatch({
        type: "SET_JSON_ERROR",
        payload: error instanceof Error ? error.message : t("forms.aiGenerationFailed"),
      });
    } finally {
      dispatch({ type: "SET_AI_GENERATING", payload: false });
    }
  }, [state.aiPrompt, handleJsonChange, t]);

  // Add food item
  const addFood = useCallback(() => {
    if (state.foodInput.trim()) {
      dispatch({ type: "ADD_FOOD", payload: state.foodInput.trim() });
    }
  }, [state.foodInput]);

  // Remove food item
  const removeFood = useCallback((index: number) => {
    dispatch({ type: "REMOVE_FOOD", payload: index });
  }, []);

  // Update form field
  const updateField = useCallback(
    <K extends keyof EventFormData>(field: K, value: EventFormData[K]) => {
      dispatch({ type: "UPDATE_FIELD", payload: { field, value } });
    },
    []
  );

  // Sync selectedDate with formData.date
  const handleDateChange = useCallback((date: Date | undefined) => {
    dispatch({ type: "SET_SELECTED_DATE", payload: date });
  }, []);

  // Image upload state
  const [imagePreview, setImagePreview] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);

  const onImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setImagePreview((ev.target?.result as string) || "");
    reader.readAsDataURL(file);
  }, []);

  const onRemoveImage = useCallback(() => {
    setImagePreview("");
    setImageFile(null);
  }, []);

  // Check if form is valid
  const isValid = isEventFormValid(state.formData, errors);

  // Sync formData to JSON when needed
  const syncToJSON = useCallback(() => {
    dispatch({
      type: "SET_JSON_VALUE",
      payload: JSON.stringify(state.formData, null, 2),
    });
  }, [state.formData]);

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

    // Image upload
    imagePreview,
    imageFile,
    onImageUpload,
    onRemoveImage,

    // AI generation
    aiPrompt: state.aiPrompt,
    setAiPrompt: (prompt: string) => dispatch({ type: "SET_AI_PROMPT", payload: prompt }),
    aiGenerating: state.aiGenerating,
    handleAiGenerate,

    // Utilities
    markAllFieldsTouched: () => {
      const allTouched = markAllFieldsTouched();
      dispatch({ type: "SET_TOUCHED", payload: allTouched });
    },
  };
}
