import { useMemo, useCallback, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { Club, EventFormData, EventFormOccurrence } from "@/shared/types";
import {
  validateEventForm,
  isEventFormValid,
  markAllFieldsTouched as markAllFieldsTouchedFn,
  type EventFormRules,
} from "@/shared/services/validationService";
import { useForm } from "@/shared/hooks/useForm";
import { useTagInput } from "@/shared/hooks/useTagInput";
import { useImageFile } from "@/shared/hooks/useImageFile";
import {
  getEventFormDefaults,
  mapEventInputToFormData,
  withLocation,
} from "@/features/events/hooks/useEventForm.utils";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import { getCurrentSchool } from "@/shared/constants/schools";

/** The club a new event is fixed to: its id, and its record once loaded. */
export interface FixedClub {
  clubId: number;
  club?: Club;
}

interface UseEventFormOptions {
  initialData?: EventFormData;
  isEditMode?: boolean;
  isOpen: boolean;
  /** A club owner's own club, which every event they add belongs to. */
  fixedClub?: FixedClub | null;
}

export function useEventForm(options: UseEventFormOptions) {
  const { getSchoolTimezone } = useSchoolDirectory();
  const { initialData, isEditMode = false, isOpen, fixedClub } = options;
  const fixedClubId = fixedClub?.clubId ?? null;
  const fixedClubSchool = fixedClub?.club?.school;
  const getDefaults = useCallback(
    () => ({ ...getEventFormDefaults(getSchoolTimezone(getCurrentSchool())), club_id: fixedClubId }),
    [getSchoolTimezone, fixedClubId],
  );
  const { t } = useTranslation();

  // Existing unlinked events remain editable; new events require a club.
  const rules = useMemo<EventFormRules>(
    () => ({ requireClub: !isEditMode || initialData?.club_id != null }),
    [isEditMode, initialData?.club_id],
  );
  const validate = useCallback(
    (data: EventFormData, touched: Record<string, boolean>) =>
      validateEventForm(
        data,
        touched,
        {
          titleRequired: t("forms.titleRequired"),
          clubRequired: t("forms.clubRequired"),
          occurrenceRequired: t("forms.occurrenceRequired"),
          locationRequired: t("forms.locationRequired"),
        },
        rules,
      ) as Record<string, string>,
    [t, rules]
  );
  const form = useForm<EventFormData>({
    initialData,
    isEditMode,
    isOpen,
    getDefaults,
    validate,
  });

  const errors = form.errors as import("@/shared/types").ValidationErrors;

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

  // The map follows the venue as typed; a saved event keeps its saved map location for its saved venue.
  const updateLocation = useCallback(
    (location: string) => {
      form.setFormData((prev) => withLocation(prev, location, isEditMode ? initialData : undefined));
    },
    [form, isEditMode, initialData],
  );

  // A club owner's event is their club's, in their club's campus time, from the moment both are known.
  const { setFormData } = form;
  useEffect(() => {
    if (fixedClubId == null) return;
    const timeZone = fixedClubSchool ? getSchoolTimezone(fixedClubSchool) : undefined;
    setFormData((prev) =>
      prev.club_id === fixedClubId && (!timeZone || prev.timeZone === timeZone)
        ? prev
        : { ...prev, club_id: fixedClubId, timeZone: timeZone ?? prev.timeZone },
    );
  }, [fixedClubId, fixedClubSchool, getSchoolTimezone, setFormData]);

  // Preserve the current poster until a replacement is uploaded.
  const { imagePreview, imageFile, onImageUpload, onRemoveImage, resetImage } =
    useImageFile(initialData?.source_image_url ?? "");

  // Reset extras (food/image) on modal open; useForm owns formData/touched.
  const prevIsOpenRef = useRef(isOpen);
  const prevInitialDataRef = useRef<EventFormData | undefined>(undefined);

  useEffect(() => {
    if (isOpen && !prevIsOpenRef.current) {
      foodTag.reset();
      resetImage(initialData?.source_image_url ?? "");
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
      form.setFormData(initialData);
      resetImage(initialData.source_image_url ?? "");
      prevInitialDataRef.current = initialData;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, isEditMode, initialData]);

  // Only creation requires a poster; existing events can be edited without one.
  const isValid = useMemo(
    () =>
      isEventFormValid(form.formData, errors, rules) &&
      (isEditMode || Boolean(imagePreview)),
    [form.formData, errors, imagePreview, isEditMode, rules],
  );

  /** Fills the form from a read flyer. A club owner's own club stays, whichever club the flyer names. */
  const applyParsedEvent = useCallback(
    (parsed: EventFormData) => {
      setFormData((previous) => {
        const next = mapEventInputToFormData(
          parsed as unknown as Record<string, unknown>,
          {
            timeZone: previous.timeZone,
            occurrences: previous.occurrences,
            source_image_url: previous.source_image_url,
          },
        );
        return fixedClubId == null ? next : { ...next, club_id: previous.club_id };
      });
      if (parsed.source_image_url) resetImage(parsed.source_image_url);
    },
    [setFormData, fixedClubId, resetImage],
  );

  const markAllFieldsTouched = useCallback(() => {
    // useForm does not expose setTouched; touch each required field via handleBlur.
    const allTouched = markAllFieldsTouchedFn();
    Object.keys(allTouched).forEach((field) => form.handleBlur(field));
  }, [form]);

  return {
    formData: form.formData,
    updateField: form.updateField,

    updateOccurrence,
    addOccurrence,
    removeOccurrence,

    foodInput: foodTag.inputValue,
    setFoodInput: foodTag.setInputValue,
    addFood: foodTag.handleAdd,
    removeFood,

    updateLocation,
    applyParsedEvent,
    fixedClub: fixedClub ?? null,

    errors,
    touched: form.touched,
    handleBlur: form.handleBlur,
    isValid,

    imagePreview,
    imageFile,
    onImageUpload,
    onRemoveImage,

    markAllFieldsTouched,
  };
}
