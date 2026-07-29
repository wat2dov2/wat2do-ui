import type { School, SchoolSummary } from "@/shared/api/schools.api";

type SchoolBrandingSource = Pick<
  School | SchoolSummary,
  "primary_color" | "secondary_color"
>;

export interface SchoolColors {
  primary: string;
  secondary: string;
}

export function getSchoolColors(school: SchoolBrandingSource): SchoolColors {
  return {
    primary: school.primary_color,
    secondary: school.secondary_color,
  };
}
