
import { getSchoolDisplayName } from "@/shared/constants/schools";

/**
 * School slugs are backend-owned data; display labels stay at the UI edge.
 */
export function translateSchool(school: string): string {
  return getSchoolDisplayName(school);
}
