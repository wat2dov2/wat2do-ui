import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { EventFormData, EventFormOccurrence } from "@/shared/types";
import {
  validateEventForm,
  isEventFormValid,
  markAllFieldsTouched as markAllFieldsTouchedFn,
} from "@/shared/services/validationService";
import { useForm } from "@/shared/hooks/useForm";
import { useTagInput } from "@/shared/hooks/useTagInput";
import {
  getInitialState,
  getSmartDefaults,
  mapAiResponseToFormData,
} from "@/features/events/hooks/useEventForm.utils";

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

  // Use the shared useForm hook for core form state (formData, touched, updateField,
  // handleBlur, reset). We supply a validate callback so `errors` is derived inside
  // the hook — but we still re-expose it with the EventFormData-specific ValidationErrors
  // shape below.
  const getDefaults = useCallback(() => getInitialState(initialData, isEditMode).formData, [
    initialData,
    isEditMode,
  ]);
  const validate = useCallback(
    (data: EventFormData, touched: Record<string, boolean>) =>
      validateEventForm(data, touched, {
        titleRequired: t("forms.titleRequired"),
        clubRequired: t("forms.organizationRequired"),
        occurrenceRequired: t("forms.occurrenceRequired"),
        locationRequired: t("forms.locationRequired"),
        jsonInvalid: t("forms.invalidJsonFormat"),
      }) as Record<string, string>,
    [t]
  );
  const form = useForm<EventFormData>({
    initialData,
    isEditMode,
    isOpen,
    getDefaults,
    validate,
  });

  // Re-typed errors for EventForm consumers
  const errors = form.errors as import("@/shared/types").ValidationErrors;

  // JSON editor state
  const [jsonValue, setJsonValue] = useState("");
  const [jsonError, setJsonError] = useState("");

  // Food tag input (manages its own input string; commits to formData.food)
  const foodTag = useTagInput({
    onAdd: (value) => {
      form.updateField("food", [...form.formData.food, value]);
    },
  });

  const removeFood = useCallback((index: number) => {
    form.updateField(
      "food",
      form.formData.food.filter((_, i) => i !== index)
    );
  }, [form]);

  const updateOccurrence = useCallback(
    (index: number, field: keyof EventFormOccurrence, value: string) => {
      form.setFormData((prev) => ({
        ...prev,
        occurrences: prev.occurrences.map((occurrence, currentIndex) =>
          currentIndex === index ? { ...occurrence, [field]: value } : occurrence
        ),
      }));
    },
    [form],
  );

  const addOccurrence = useCallback(() => {
    form.setFormData((prev) => ({
      ...prev,
      occurrences: [...prev.occurrences, { dtstart_local: "", dtend_local: "" }],
    }));
  }, [form]);

  const removeOccurrence = useCallback(
    (index: number) => {
      form.setFormData((prev) => ({
        ...prev,
        occurrences:
          prev.occurrences.length > 1
            ? prev.occurrences.filter((_, currentIndex) => currentIndex !== index)
            : prev.occurrences,
      }));
    },
    [form],
  );

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

  // Reset extras (date/json/food/image) on modal open or when initialData is re-seeded.
  // useForm handles formData/touched reset on isOpen transition; we mirror that here for
  // the fields that live outside useForm.
  const prevIsOpenRef = useRef(isOpen);
  const prevInitialDataRef = useRef<EventFormData | undefined>(undefined);

  useEffect(() => {
    if (isOpen && !prevIsOpenRef.current) {
      setJsonValue("");
      setJsonError("");
      foodTag.reset();
      setImagePreview("");
      setImageFile(null);
      prevInitialDataRef.current = initialData;
    }
    prevIsOpenRef.current = isOpen;

    if (!isOpen) {
      prevInitialDataRef.current = undefined;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Re-seed when initialData arrives after opening (e.g. fetched for admin edit).
  useEffect(() => {
    if (!isOpen) return;

    const shouldReseed =
      isEditMode && initialData && initialData !== prevInitialDataRef.current;

    if (shouldReseed && initialData) {
      const resetState = getInitialState(initialData, isEditMode);
      form.setFormData(resetState.formData);
      prevInitialDataRef.current = initialData;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, isEditMode, initialData]);

  // Handle JSON changes
  const handleJsonChange = useCallback(
    (value: string | undefined) => {
      if (!value) return;
      setJsonValue(value);

      try {
        const parsed = JSON.parse(value);
        setJsonError("");

        const smartDefaults = getSmartDefaults();
        form.setFormData(mapAiResponseToFormData(parsed, smartDefaults));
      } catch (err) {
        console.error("Failed to parse event form JSON:", err);
        setJsonError(t("forms.invalidJsonFormat"));
      }
    },
    [t, form]
  );

  // Sync formData to JSON when needed
  const syncToJSON = useCallback(() => {
    setJsonValue(JSON.stringify(form.formData, null, 2));
  }, [form.formData]);

  // isValid is derived from the domain-specific isEventFormValid (stronger than
  // useForm.isValid which only checks "errors is empty").
  const isValid = useMemo(
    () => isEventFormValid(form.formData, errors),
    [form.formData, errors],
  );

  const markAllFieldsTouched = useCallback(() => {
    // useForm does not expose setTouched directly. Touch each required field via handleBlur.
    const allTouched = markAllFieldsTouchedFn();
    Object.keys(allTouched).forEach((field) => form.handleBlur(field));
  }, [form]);

  return {
    // Form data
    formData: form.formData,
    setFormData: form.setFormData,
    updateField: form.updateField,

    // Occurrences
    updateOccurrence,
    addOccurrence,
    removeOccurrence,

    // Food management
    foodInput: foodTag.inputValue,
    setFoodInput: foodTag.setInputValue,
    addFood: foodTag.handleAdd,
    removeFood,

    // Validation
    errors,
    touched: form.touched,
    handleBlur: form.handleBlur,
    isValid,

    // JSON editor
    jsonValue,
    setJsonValue,
    jsonError,
    setJsonError,
    handleJsonChange,
    syncToJSON,

    // Image upload
    imagePreview,
    imageFile,
    onImageUpload,
    onRemoveImage,

    // Utilities
    markAllFieldsTouched,
  };
}
