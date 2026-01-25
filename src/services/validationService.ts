import type { EventFormData, ValidationErrors } from "@/types";

/**
 * Validation Service
 * Handles form validation logic
 */

/**
 * Validate event form data
 */
export function validateEventForm(
  formData: EventFormData,
  touched: Record<string, boolean>
): ValidationErrors {
  const errors: ValidationErrors = {};

  if (touched.title && !formData.title.trim()) {
    errors.title = "Title is required";
  }

  if (touched.organization && !formData.organization.trim()) {
    errors.organization = "Organization is required";
  }

  if (touched.date && !formData.date) {
    errors.date = "Date is required";
  }

  if (touched.time && !formData.time) {
    errors.time = "Time is required";
  }

  if (touched.location && !formData.location) {
    errors.location = "Location is required";
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
export function validateFilterJSON(jsonString: string): {
  valid: boolean;
  error: string | null;
} {
  if (!jsonString.trim()) {
    return { valid: false, error: "JSON cannot be empty" };
  }

  try {
    JSON.parse(jsonString);
    return { valid: true, error: null };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : "Invalid JSON format",
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
