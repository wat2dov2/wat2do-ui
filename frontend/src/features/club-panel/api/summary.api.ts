import type { components } from "@/shared/generated/api-types";
import { api } from "@/shared/services/apiClient";

export type ClubPanelSummary = components["schemas"]["ClubPanelSummaryResponse"];

export function fetchClubPanelSummary(clubId: number): Promise<ClubPanelSummary> {
  return api.get<ClubPanelSummary>(`/clubs/${clubId}/panel-summary`);
}
