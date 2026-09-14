import { useCallback, useMemo } from "react";
import { skipToken, useQuery } from "@tanstack/react-query";
import {
  type SchoolSummary,
} from "@/shared/api/schools.api";
import { resolveSchool } from "@/shared/constants/schools";
import { queryKeys } from "@/shared/lib/queryKeys";

const EMPTY_SCHOOLS: SchoolSummary[] = [];

export function useSchoolDirectory() {
  const query = useQuery<SchoolSummary[]>({
    queryKey: queryKeys.schools.directory(),
    queryFn: skipToken,
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
    isPending: query.isPending,
    isError: query.isError,
    schools,
    schoolBySlug,
    getSchoolName,
  };
}
