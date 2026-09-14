import { useQuery } from "@tanstack/react-query";
import { appConstantsQueryOptions, DEFAULT_APP_CONSTANTS } from "@/shared/api/metaApi";

export function useAppConstants() {
  const query = useQuery(appConstantsQueryOptions());
  return query.data ?? DEFAULT_APP_CONSTANTS;
}
