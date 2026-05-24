import type { EventFormData, ValidationErrors } from "@/shared/types";
import i18n from "@/shared/lib/i18n";

/**
 * Validation Service
 * Handles form validation logic
 */

const VALIDATION_MESSAGE_KEYS = {
  titleRequired: "forms.titleRequired",
  organizationRequired: "forms.organizationRequired",
  occurrenceRequired: "forms.occurrenceRequired",
  locationRequired: "forms.locationRequired",
  jsonEmpty: "forms.jsonEmpty",
  jsonInvalid: "forms.invalidJsonFormat",
} as const;

export type ValidationMessageOverrides = Partial<Record<keyof typeof VALIDATION_MESSAGE_KEYS, string>>;

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
): ValidationErrors {
  const m = { ...getValidationMessages(), ...messages };
  const errors: ValidationErrors = {};

  if (touched.title && !formData.title.trim()) {
    errors.title = m.titleRequired;
  }

  if (touched.organization && !formData.organization.trim()) {
    errors.organization = m.organizationRequired;
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
  errors: ValidationErrors
): boolean {
  return (
    formData.title.trim() !== "" &&
    formData.organization.trim() !== "" &&
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
    organization: true,
    occurrences: true,
    location: true,
  };
}
