import { api } from "@/shared/services/apiClient";
import type { components } from "@/shared/generated/api-types";

export type SchoolSummary = components["schemas"]["SchoolSummary"];

export async function searchSchools(query: string, limit = 10): Promise<SchoolSummary[]> {
  const params = new URLSearchParams();
  params.set("q", query);
  params.set("limit", String(limit));
  return api.get<SchoolSummary[]>(`/schools?${params.toString()}`);
}
