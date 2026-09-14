import type { EventFormData, ValidationErrors } from "@/shared/types";
import i18n from "@/shared/lib/i18n";

const VALIDATION_MESSAGE_KEYS = {
  titleRequired: "forms.titleRequired",
  clubRequired: "forms.clubRequired",
  occurrenceRequired: "forms.occurrenceRequired",
  locationRequired: "forms.locationRequired",
} as const;

type ValidationMessageOverrides = Partial<Record<keyof typeof VALIDATION_MESSAGE_KEYS, string>>;

export interface EventFormRules {
  /**
   * Whether the event must be linked to a club row.
   *
   * A scraped event carries its host's name but no link to a club,
   * and the Instagram carousel editor exists to correct exactly those events.
   * Demanding a link there would make every one of them unsaveable, so an
   * event that never had one may be edited without gaining one. Creating an
   * event always requires it.
   */
  requireClub: boolean;
}

const DEFAULT_RULES: EventFormRules = { requireClub: true };

function getValidationMessages(): Record<keyof typeof VALIDATION_MESSAGE_KEYS, string> {
  return Object.fromEntries(
    Object.entries(VALIDATION_MESSAGE_KEYS).map(([key, translationKey]) => [
      key,
      i18n.t(translationKey),
    ])
  ) as Record<keyof typeof VALIDATION_MESSAGE_KEYS, string>;
}

/**
 * Validate event form data
 */
export function validateEventForm(
  formData: EventFormData,
  touched: Record<string, boolean>,
  messages?: ValidationMessageOverrides,
  rules: EventFormRules = DEFAULT_RULES,
): ValidationErrors {
  const m = { ...getValidationMessages(), ...messages };
  const errors: ValidationErrors = {};

  if (touched.title && !formData.title.trim()) {
    errors.title = m.titleRequired;
  }

  if (rules.requireClub && touched.club_id && formData.club_id == null) {
    errors.club_id = m.clubRequired;
  }

  if (touched.occurrences && !formData.occurrences.some((occurrence) => occurrence.dtstart_local)) {
    errors.occurrences = m.occurrenceRequired;
  }

  if (touched.location && !formData.location) {
    errors.location = m.locationRequired;
  }

  return errors;
}

/**
 * Check if form is valid
 */
export function isEventFormValid(
  formData: EventFormData,
  errors: ValidationErrors,
  rules: EventFormRules = DEFAULT_RULES,
): boolean {
  return (
    formData.title.trim() !== "" &&
    (!rules.requireClub || formData.club_id != null) &&
    formData.occurrences.some((occurrence) => occurrence.dtstart_local !== "") &&
    formData.location !== "" &&
    Object.keys(errors).length === 0
  );
}

/**
 * Mark all required fields as touched
 */
export function markAllFieldsTouched(): Record<string, boolean> {
  return {
    title: true,
    club_id: true,
    occurrences: true,
    location: true,
  };
}
