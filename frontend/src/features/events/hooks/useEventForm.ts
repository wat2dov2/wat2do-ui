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
import { useDebouncedCallback } from "@/shared/hooks/useDebouncedCallback";
import { JSON_EDITOR_DEBOUNCE_MS } from "@/shared/constants/ui";
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

export function useEventForm(options: UseEventFormOptions) {
  const { initialData, isEditMode = false, isOpen } = options;
  const { t } = useTranslation();

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

  const errors = form.errors as import("@/shared/types").ValidationErrors;

  const [jsonValue, setJsonValue] = useState("");
  const [jsonError, setJsonError] = useState("");

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

  // Editing an existing event starts from its current poster: it is the event's
  // image until someone uploads a replacement, and the form requires one.
  const [imagePreview, setImagePreview] = useState(
    () => initialData?.source_image_url ?? "",
  );
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

  // Reset extras (json/food/image) on modal open; useForm owns formData/touched.
  const prevIsOpenRef = useRef(isOpen);
  const prevInitialDataRef = useRef<EventFormData | undefined>(undefined);

  useEffect(() => {
    if (isOpen && !prevIsOpenRef.current) {
      setJsonValue("");
      setJsonError("");
      foodTag.reset();
      setImagePreview(initialData?.source_image_url ?? "");
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
      setImagePreview(initialData.source_image_url ?? "");
      setImageFile(null);
      prevInitialDataRef.current = initialData;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, isEditMode, initialData]);

  // Update the editor immediately; parse after debounce.
  const applyJsonParse = useCallback(
    (value: string) => {
      try {
        const parsed = JSON.parse(value);
        setJsonError("");

        form.setFormData((previous) =>
          mapAiResponseToFormData(parsed, {
            occurrences: getSmartDefaults().occurrences,
            source_image_url: previous.source_image_url,
          }),
        );
      } catch (err) {
        console.error("Failed to parse event form JSON:", err);
        setJsonError(t("forms.invalidJsonFormat"));
      }
    },
    [form, t],
  );

  const debouncedApplyJsonParse = useDebouncedCallback(
    applyJsonParse,
    JSON_EDITOR_DEBOUNCE_MS,
  );

  const handleJsonChange = useCallback(
    (value: string | undefined) => {
      if (!value) return;
      setJsonValue(value);
      debouncedApplyJsonParse(value);
    },
    [debouncedApplyJsonParse],
  );

  const syncToJSON = useCallback(() => {
    setJsonValue(JSON.stringify(form.formData, null, 2));
  }, [form.formData]);

  const isValid = useMemo(
    () => isEventFormValid(form.formData, errors) && Boolean(imagePreview),
    [form.formData, errors, imagePreview],
  );

  const markAllFieldsTouched = useCallback(() => {
    // useForm does not expose setTouched; touch each required field via handleBlur.
    const allTouched = markAllFieldsTouchedFn();
    Object.keys(allTouched).forEach((field) => form.handleBlur(field));
  }, [form]);

  return {
    formData: form.formData,
    setFormData: form.setFormData,
    updateField: form.updateField,

    updateOccurrence,
    addOccurrence,
    removeOccurrence,

    foodInput: foodTag.inputValue,
    setFoodInput: foodTag.setInputValue,
    addFood: foodTag.handleAdd,
    removeFood,

    errors,
    touched: form.touched,
    handleBlur: form.handleBlur,
    isValid,

    jsonValue,
    setJsonValue,
    jsonError,
    setJsonError,
    handleJsonChange,
    syncToJSON,

    imagePreview,
    imageFile,
    onImageUpload,
    onRemoveImage,
    setImagePreview,
    setImageFile,

    markAllFieldsTouched,
  };
}
