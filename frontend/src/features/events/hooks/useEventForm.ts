import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { EventFormData } from "@/shared/types";
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
  /** When 1, form was opened for edit and fetched data is ready; use to force reset with initialData. */
  editDataReady?: 0 | 1;
}

/**
 * Custom hook for managing event form state and validation
 */
export function useEventForm(options: UseEventFormOptions) {
  const { initialData, isEditMode = false, isOpen, editDataReady = 0 } = options;
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
      validateEventForm(data, touched) as Record<string, string>,
    []
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

  // Date picker state (tracks Date object; formData.date holds the ISO string)
  const initialSelectedDate = useMemo(
    () => getInitialState(initialData, isEditMode).selectedDate,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(initialSelectedDate);

  const handleDateChange = useCallback((date: Date | undefined) => {
    setSelectedDate(date);
    const dateStr = date ? date.toISOString().split("T")[0] : "";
    form.updateField("date", dateStr);
  }, [form]);

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
  const prevEditDataReadyRef = useRef(editDataReady);

  useEffect(() => {
    if (isOpen && !prevIsOpenRef.current) {
      const resetState = getInitialState(initialData, isEditMode);
      setSelectedDate(resetState.selectedDate);
      setJsonValue("");
      setJsonError("");
      foodTag.reset();
      setImagePreview("");
      setImageFile(null);
      prevInitialDataRef.current = initialData;
      prevEditDataReadyRef.current = editDataReady;
    }
    prevIsOpenRef.current = isOpen;

    if (!isOpen) {
      prevInitialDataRef.current = undefined;
      prevEditDataReadyRef.current = 0;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Re-seed when initialData arrives after opening (e.g. fetched for admin edit).
  useEffect(() => {
    if (!isOpen) return;

    const fetchedDataJustReady =
      isEditMode &&
      editDataReady === 1 &&
      prevEditDataReadyRef.current !== 1 &&
      initialData;

    const shouldReseed =
      fetchedDataJustReady ||
      (isEditMode && initialData && initialData !== prevInitialDataRef.current);

    if (shouldReseed && initialData) {
      const resetState = getInitialState(initialData, isEditMode);
      form.setFormData(resetState.formData);
      setSelectedDate(resetState.selectedDate);
      prevInitialDataRef.current = initialData;
    }
    if (editDataReady === 1) prevEditDataReadyRef.current = 1;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, isEditMode, editDataReady, initialData]);

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

    // Date picker
    selectedDate,
    handleDateChange,

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
