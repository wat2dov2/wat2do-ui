import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  searchSchools,
  type SchoolSummary,
} from "@/shared/api/schools.api";
import { resolveSchool } from "@/shared/constants/schools";
import { queryKeys } from "@/shared/lib/queryKeys";

const EMPTY_SCHOOLS: SchoolSummary[] = [];

export function useSchoolDirectory() {
  const query = useQuery({
    queryKey: queryKeys.schools.directory(),
    queryFn: () => searchSchools("", 50),
  });
  const schools = query.data ?? EMPTY_SCHOOLS;
  const schoolBySlug = useMemo(
    () => new Map(schools.map((school) => [school.slug, school])),
    [schools],
  );
  const getSchoolName = useCallback(
    (school: string | null | undefined) => {
      const slug = resolveSchool(school);
      return schoolBySlug.get(slug)?.name ?? slug;
    },
    [schoolBySlug],
  );

  return {
    ...query,
    schools,
    schoolBySlug,
    getSchoolName,
  };
}
