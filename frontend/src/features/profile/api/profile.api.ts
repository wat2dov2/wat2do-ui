import type { ApiMySubmissionsResponse } from "@/shared/generated";
import { api } from "@/shared/services/apiClient";

/** Everything the signed-in user submitted for review: events, positions and clubs, newest first. */
export function fetchMySubmissions(): Promise<ApiMySubmissionsResponse> {
  return api.get<ApiMySubmissionsResponse>("/users/me/submissions");
}
