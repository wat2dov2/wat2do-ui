import type { components } from "@/shared/generated/api-types";
import { api } from "@/shared/services/apiClient";

export type ClubCounts = components["schemas"]["ClubCounts"];

/** The club's upcoming events, open positions and team members, for its team. */
export function fetchClubCounts(clubId: number): Promise<ClubCounts> {
  return api.get<ClubCounts>(`/clubs/${clubId}/counts`);
}
