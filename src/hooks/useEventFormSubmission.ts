import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { getSmartDefaults } from "@/utils/date";
import { validateEventForm, markAllFieldsTouched } from "@/services/validationService";
import type { EventFormData, ValidationErrors } from "@/types";

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
  const smartDefaults = getSmartDefaults();

  const [formData, setFormData] = useState<EventFormData>({
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
  });

  const [selectedDate, setSelectedDate] = useState<Date | undefined>(() => {
    if (smartDefaults.date) {
      const date = new Date(smartDefaults.date);
      return isNaN(date.getTime()) ? undefined : date;
    }
    return undefined;
  });

  const [foodInput, setFoodInput] = useState("");
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [createdEventId, setCreatedEventId] = useState<number | null>(null);
  const [successMessage, setSuccessMessage] = useState("");

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setIsSubmitted(false);
      setCreatedEventId(null);
      const defaults = getSmartDefaults();

      if (isEditMode && initialData) {
        setFormData(initialData);
        if (initialData.date) {
          const date = new Date(initialData.date);
          setSelectedDate(isNaN(date.getTime()) ? undefined : date);
        } else {
          setSelectedDate(undefined);
        }
      } else {
        setFormData({
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
        });
        if (defaults.date) {
          const date = new Date(defaults.date);
          setSelectedDate(isNaN(date.getTime()) ? undefined : date);
        } else {
          setSelectedDate(undefined);
        }
      }

      setErrors({});
      setTouched({});
    }
  }, [isOpen, isEditMode, initialData]);

  // Validate on change
  useEffect(() => {
    const newErrors = validateEventForm(formData, touched);
    setErrors(newErrors);
  }, [formData, touched]);

  const handleBlur = useCallback((field: string) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
  }, []);

  const handleSubmit = useCallback(() => {
    const allTouched = markAllFieldsTouched();
    setTouched(allTouched);

    const validationErrors = validateEventForm(formData, allTouched);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    if (isEditMode && editEventId && onUpdate) {
      onUpdate(editEventId, formData);
      setSuccessMessage(t("events.eventUpdatedMessage", { title: formData.title }));
      return;
    }

    const eventId = onSubmit(formData);
    setCreatedEventId(eventId);
    setIsSubmitted(true);
  }, [formData, isEditMode, editEventId, onUpdate, onSubmit, t]);

  const addFood = useCallback(() => {
    if (foodInput.trim()) {
      setFormData((prev) => ({
        ...prev,
        food: [...prev.food, foodInput.trim()],
      }));
      setFoodInput("");
    }
  }, [foodInput]);

  const removeFood = useCallback((index: number) => {
    setFormData((prev) => ({
      ...prev,
      food: prev.food.filter((_, i) => i !== index),
    }));
  }, []);

  const isFormValid =
    formData.title.trim() &&
    formData.organization.trim() &&
    formData.date &&
    formData.time &&
    formData.location;

  return {
    formData,
    setFormData,
    selectedDate,
    setSelectedDate,
    foodInput,
    setFoodInput,
    errors,
    touched,
    isSubmitted,
    createdEventId,
    successMessage,
    setSuccessMessage,
    handleBlur,
    handleSubmit,
    addFood,
    removeFood,
    isFormValid,
  };
}
