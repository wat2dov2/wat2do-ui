import { useReducer, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { getSmartDefaults } from "@/shared/utils/date";
import { validateEventForm, markAllFieldsTouched } from "@/shared/services/validationService";
import type { EventFormData, ValidationErrors } from "@/shared/types";
import {
  eventFormSubmissionReducer,
  type EventFormSubmissionState,
} from "@/features/events/hooks/useEventFormSubmission.reducer";

interface UseEventFormSubmissionOptions {
  isOpen: boolean;
  isEditMode: boolean;
  initialData?: EventFormData;
  onSubmit: (eventData: EventFormData) => number;
  onUpdate?: (eventId: number, eventData: EventFormData) => void;
  editEventId?: number;
}

/**
 * Hook for managing event form submission logic
 * Handles form state, validation, and submission
 */
export function useEventFormSubmission({
  isOpen,
  isEditMode,
  initialData,
  onSubmit,
  onUpdate,
  editEventId,
}: UseEventFormSubmissionOptions) {
  const { t } = useTranslation();

  // Get initial state
  const getInitialState = useCallback((): EventFormSubmissionState => {
    const defaults = getSmartDefaults();
    const formData = isEditMode && initialData
      ? initialData
      : {
          title: "",
          description: "",
          date: defaults.date,
          time: defaults.time,
          location: "",
          category: "",
          price: 0,
          food: [],
          requiresRegistration: false,
          organization: "",
        };

    const dateStr = formData.date || defaults.date;
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
      isSubmitted: false,
      createdEventId: null,
      successMessage: "",
    };
  }, [isEditMode, initialData]);

  const [state, dispatch] = useReducer(
    eventFormSubmissionReducer,
    getInitialState()
  );

  // Validate on change - derived state (no need to store in reducer)
  const errors = useMemo(
    () => validateEventForm(state.formData, state.touched),
    [state.formData, state.touched]
  );

  // Reset function - can be called from parent when modal opens
  const reset = useCallback(() => {
    if (isOpen) {
      const initialState = getInitialState();
      dispatch({
        type: "RESET",
        payload: {
          formData: initialState.formData,
          selectedDate: initialState.selectedDate,
        },
      });
    }
  }, [isOpen, getInitialState]);

  const handleBlur = useCallback((field: string) => {
    dispatch({
      type: "SET_TOUCHED",
      payload: { ...state.touched, [field]: true },
    });
  }, [state.touched]);

  const handleSubmit = useCallback(() => {
    const allTouched = markAllFieldsTouched();
    dispatch({ type: "SET_TOUCHED", payload: allTouched });

    // Use derived errors for validation
    const validationErrors = validateEventForm(state.formData, allTouched);
    if (Object.keys(validationErrors).length > 0) {
      // Errors are derived, no need to dispatch
      return;
    }

    if (isEditMode && editEventId && onUpdate) {
      onUpdate(editEventId, state.formData);
      dispatch({
        type: "SET_SUCCESS_MESSAGE",
        payload: t("events.eventUpdatedMessage", { title: state.formData.title }),
      });
      return;
    }

    const eventId = onSubmit(state.formData);
    dispatch({ type: "SET_CREATED_EVENT_ID", payload: eventId });
    dispatch({ type: "SET_IS_SUBMITTED", payload: true });
  }, [state.formData, isEditMode, editEventId, onUpdate, onSubmit, t]);

  const addFood = useCallback(() => {
    if (state.foodInput.trim()) {
      dispatch({
        type: "SET_FORM_DATA",
        payload: {
          ...state.formData,
          food: [...state.formData.food, state.foodInput.trim()],
        },
      });
      dispatch({ type: "SET_FOOD_INPUT", payload: "" });
    }
  }, [state.foodInput, state.formData]);

  const removeFood = useCallback(
    (index: number) => {
      dispatch({
        type: "SET_FORM_DATA",
        payload: {
          ...state.formData,
          food: state.formData.food.filter((_, i) => i !== index),
        },
      });
    },
    [state.formData]
  );

  const isFormValid = useMemo(
    () =>
      state.formData.title.trim() &&
      state.formData.organization.trim() &&
      state.formData.date &&
      state.formData.time &&
      state.formData.location,
    [state.formData]
  );

  return {
    formData: state.formData,
    setFormData: (data: EventFormData) =>
      dispatch({ type: "SET_FORM_DATA", payload: data }),
    selectedDate: state.selectedDate,
    setSelectedDate: (date: Date | undefined) =>
      dispatch({ type: "SET_SELECTED_DATE", payload: date }),
    foodInput: state.foodInput,
    setFoodInput: (value: string) =>
      dispatch({ type: "SET_FOOD_INPUT", payload: value }),
    errors, // Use derived errors instead of state.errors
    touched: state.touched,
    isSubmitted: state.isSubmitted,
    createdEventId: state.createdEventId,
    successMessage: state.successMessage,
    setSuccessMessage: (message: string) =>
      dispatch({ type: "SET_SUCCESS_MESSAGE", payload: message }),
    handleBlur,
    handleSubmit,
    addFood,
    removeFood,
    isFormValid,
    reset,
  };
}
