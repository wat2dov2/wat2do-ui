export const availableSchools = [
  "University of Waterloo",
  "University of Toronto",
  "McGill University",
  "University of British Columbia",
  "McMaster University",
];

/** Default school used as a fallback throughout the app. */
export const DEFAULT_SCHOOL = availableSchools[0]; // "University of Waterloo"

/**
 * Maps email domains to school names.
 *
 * Values must match entries in `availableSchools` so lookups are
 * consistent across the app.  Multiple domains can point to the same
 * school (e.g. mail.utoronto.ca and utoronto.ca).
 */
export const DOMAIN_TO_SCHOOL: Record<string, string> = {
  "uwaterloo.ca": "University of Waterloo",
  "utoronto.ca": "University of Toronto",
  "mail.utoronto.ca": "University of Toronto",
  "mcgill.ca": "McGill University",
  "mail.mcgill.ca": "McGill University",
  "ubc.ca": "University of British Columbia",
  "student.ubc.ca": "University of British Columbia",
  "mcmaster.ca": "McMaster University",
};
