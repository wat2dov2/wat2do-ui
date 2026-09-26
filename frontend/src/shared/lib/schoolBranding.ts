import type { CSSProperties } from "react";
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

/** Page tokens share the school directory already embedded in the document. */
export function getSchoolThemeStyle(school?: SchoolBrandingSource): CSSProperties | undefined {
  if (!school) return undefined;
  const colors = getSchoolColors(school);
  const style: CSSProperties & Record<`--page-school-${string}`, string> = {
    "--page-school-primary": colors.primary,
    "--page-school-secondary": colors.secondary,
  };
  return style;
}
