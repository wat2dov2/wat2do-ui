import { api } from "@/shared/services/apiClient";

export async function searchSchools(query: string, limit = 10): Promise<string[]> {
  const params = new URLSearchParams();
  params.set("q", query);
  params.set("limit", String(limit));
  return api.get<string[]>(`/schools?${params.toString()}`);
}
