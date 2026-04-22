import type { EventFormData, ValidationErrors } from "@/shared/types";

/**
 * Validation Service
 * Handles form validation logic
 */

/** Default validation error message keys — can be overridden with translated strings. */
export const VALIDATION_MESSAGES = {
  titleRequired: "Title is required",
  organizationRequired: "Organization is required",
  dateRequired: "Date is required",
  timeRequired: "Time is required",
  locationRequired: "Location is required",
  jsonEmpty: "JSON cannot be empty",
  jsonInvalid: "Invalid JSON format",
} as const;

export type ValidationMessageOverrides = Partial<Record<keyof typeof VALIDATION_MESSAGES, string>>;

/**
 * Validate event form data
 */
export function validateEventForm(
  formData: EventFormData,
  touched: Record<string, boolean>,
  messages?: ValidationMessageOverrides,
): ValidationErrors {
  const m = { ...VALIDATION_MESSAGES, ...messages };
  const errors: ValidationErrors = {};

  if (touched.title && !formData.title.trim()) {
    errors.title = m.titleRequired;
  }

  if (touched.organization && !formData.organization.trim()) {
    errors.organization = m.organizationRequired;
  }

  if (touched.date && !formData.date) {
    errors.date = m.dateRequired;
  }

  if (touched.time && !formData.time) {
    errors.time = m.timeRequired;
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
    formData.date !== "" &&
    formData.time !== "" &&
    formData.location !== "" &&
    Object.keys(errors).length === 0
  );
}

/**
 * Validate filter JSON
 */
export function validateFilterJSON(
  jsonString: string,
  messages?: ValidationMessageOverrides,
): {
  valid: boolean;
  error: string | null;
} {
  const m = { ...VALIDATION_MESSAGES, ...messages };
  if (!jsonString.trim()) {
    return { valid: false, error: m.jsonEmpty };
  }

  try {
    JSON.parse(jsonString);
    return { valid: true, error: null };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : m.jsonInvalid,
    };
  }
}

/**
 * Mark all required fields as touched
 */
export function markAllFieldsTouched(): Record<string, boolean> {
  return {
    title: true,
    organization: true,
    date: true,
    time: true,
    location: true,
  };
}
