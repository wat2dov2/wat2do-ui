import type { EventFormData, ValidationErrors } from "@/shared/types";
import i18n from "@/shared/lib/i18n";
import { buildEventOccurrence } from "@/shared/api/eventPayload";
import { isVirtualLocation } from "@/shared/utils/event";

function validOccurrences(formData: EventFormData): boolean {
  try {
    const occurrences = formData.occurrences.filter((item) => item.dtstart_local);
    return occurrences.length > 0 && occurrences.every((item) => {
      const { dtstart_utc, dtend_utc } = buildEventOccurrence(item, formData.timeZone);
      return !dtend_utc || Date.parse(dtend_utc) > Date.parse(dtstart_utc);
    });
  } catch {
    return false;
  }
}

const VALIDATION_MESSAGE_KEYS = {
  titleRequired: "forms.titleRequired",
  clubRequired: "forms.clubRequired",
  occurrenceRequired: "forms.occurrenceRequired",
  locationRequired: "forms.locationRequired",
  mapLocationRequired: "forms.mapLocationRequired",
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
  /** The saved location and map location being edited; empty for a new event. */
  initialLocation: string;
  initialMapLocation: string;
}

const DEFAULT_RULES: EventFormRules = { requireClub: true, initialLocation: "", initialMapLocation: "" };

/**
 * A physical venue needs a map location, except an unchanged venue that never
 * had one (an event saved with "TBD" stays editable).
 */
export function isMapLocationRequired(formData: EventFormData, rules: EventFormRules): boolean {
  const location = formData.location.trim();
  if (!location || isVirtualLocation(location)) return false;
  return location !== rules.initialLocation.trim() || rules.initialMapLocation.trim() !== "";
}

/**
 * A changed venue needs a new map location: the map location is never left
 * describing the previous venue.
 */
function mapLocationMissing(formData: EventFormData, rules: EventFormRules): boolean {
  if (!isMapLocationRequired(formData, rules)) return false;
  const mapLocation = formData.map_location.trim();
  if (formData.location.trim() === rules.initialLocation.trim()) return !mapLocation;
  return !mapLocation || mapLocation === rules.initialMapLocation.trim();
}

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

  if (touched.occurrences && !validOccurrences(formData)) {
    errors.occurrences = m.occurrenceRequired;
  }

  if (touched.location && !formData.location) {
    errors.location = m.locationRequired;
  }

  if (touched.map_location && mapLocationMissing(formData, rules)) {
    errors.map_location = m.mapLocationRequired;
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
    validOccurrences(formData) &&
    formData.location !== "" &&
    !mapLocationMissing(formData, rules) &&
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
    map_location: true,
  };
}
